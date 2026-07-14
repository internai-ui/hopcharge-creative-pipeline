provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project   = var.project
      ManagedBy = "terraform"
    }
  }
}

# ── Networking ────────────────────────────────────────────────────────────────
# A dedicated VPC + public subnets. We do NOT rely on a "default VPC" because
# Organization-managed / security-baselined accounts often have none, which would
# make this fail on `plan`. This makes the stack work in any account, first try.
data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  az_count = min(3, length(data.aws_availability_zones.available.names))
}

resource "aws_vpc" "this" {
  cidr_block           = "10.20.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = { Name = var.project }
}

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id
  tags   = { Name = var.project }
}

resource "aws_subnet" "public" {
  count                   = local.az_count
  vpc_id                  = aws_vpc.this.id
  cidr_block              = cidrsubnet(aws_vpc.this.cidr_block, 8, count.index)
  availability_zone       = data.aws_availability_zones.available.names[count.index]
  map_public_ip_on_launch = true

  tags = { Name = "${var.project}-public-${count.index}" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.this.id
  }

  tags = { Name = "${var.project}-public" }
}

resource "aws_route_table_association" "public" {
  count          = local.az_count
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

# ── S3: private bucket for generated creatives ────────────────────────────────
# Random suffix guarantees the bucket name is globally unique (S3 names are global),
# so `apply` never fails on a name collision. The real name is an output.
resource "random_id" "bucket" {
  byte_length = 4
}

resource "aws_s3_bucket" "creatives" {
  bucket = "${var.s3_bucket_prefix}-${random_id.bucket.hex}"
}

# Fully private — the app hands out short-lived presigned URLs, so nothing is public.
resource "aws_s3_bucket_public_access_block" "creatives" {
  bucket                  = aws_s3_bucket.creatives.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "creatives" {
  bucket = aws_s3_bucket.creatives.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_versioning" "creatives" {
  count  = var.s3_versioning ? 1 : 0
  bucket = aws_s3_bucket.creatives.id

  versioning_configuration {
    status = "Enabled"
  }
}

# ── IAM: the credentials the app uses to read/write the bucket ────────────────
resource "aws_iam_user" "app" {
  name = "${var.project}-s3"
}

resource "aws_iam_user_policy" "app_s3" {
  name = "s3-creatives-access"
  user = aws_iam_user.app.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ListBucket"
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = [aws_s3_bucket.creatives.arn]
      },
      {
        Sid      = "ObjectReadWrite"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        Resource = ["${aws_s3_bucket.creatives.arn}/*"]
      },
    ]
  })
}

resource "aws_iam_access_key" "app" {
  user = aws_iam_user.app.name
}

# ── RDS: PostgreSQL ───────────────────────────────────────────────────────────
# URL-safe (no special chars) so it drops straight into DATABASE_URL without escaping.
resource "random_password" "db" {
  length  = 32
  special = false
}

resource "aws_db_subnet_group" "this" {
  name       = "${var.project}-db"
  subnet_ids = aws_subnet.public[*].id
}

resource "aws_security_group" "db" {
  name        = "${var.project}-db"
  description = "Postgres access for ${var.project}"
  vpc_id      = aws_vpc.this.id

  ingress {
    description = "PostgreSQL"
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = var.db_allowed_cidrs
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_db_instance" "this" {
  identifier     = "${var.project}-db"
  engine         = "postgres"
  engine_version = var.postgres_version
  instance_class = var.db_instance_class

  db_name  = var.db_name
  username = var.db_username
  password = random_password.db.result

  allocated_storage = var.db_allocated_storage
  storage_type      = "gp3"
  storage_encrypted = true

  db_subnet_group_name   = aws_db_subnet_group.this.name
  vpc_security_group_ids = [aws_security_group.db.id]
  publicly_accessible    = true

  multi_az                   = false
  auto_minor_version_upgrade = true
  backup_retention_period    = var.db_backup_retention_days
  deletion_protection        = var.db_deletion_protection
  skip_final_snapshot        = var.db_skip_final_snapshot
  final_snapshot_identifier  = var.db_skip_final_snapshot ? null : "${var.project}-final"
  apply_immediately          = true
}
