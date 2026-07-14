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
# Reuse the account's default VPC + subnets (public, spread across AZs). This keeps
# the setup a single `apply` with no custom VPC to manage, and its subnets already
# have an internet gateway route so RDS can be publicly reachable from Vercel.
data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

# ── S3: private bucket for generated creatives ────────────────────────────────
resource "aws_s3_bucket" "creatives" {
  bucket = var.s3_bucket_name
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
  subnet_ids = data.aws_subnets.default.ids
}

resource "aws_security_group" "db" {
  name        = "${var.project}-db"
  description = "Postgres access for ${var.project}"
  vpc_id      = data.aws_vpc.default.id

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
