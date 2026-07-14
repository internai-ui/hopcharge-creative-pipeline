# Values below map directly onto the app's env vars. Sensitive ones are hidden by
# default — reveal with `terraform output -raw <name>`.

output "s3_bucket" {
  description = "AWS_S3_BUCKET"
  value       = aws_s3_bucket.creatives.bucket
}

output "aws_region" {
  description = "AWS_REGION"
  value       = var.aws_region
}

output "aws_access_key_id" {
  description = "AWS_ACCESS_KEY_ID"
  value       = aws_iam_access_key.app.id
}

output "aws_secret_access_key" {
  description = "AWS_SECRET_ACCESS_KEY (terraform output -raw aws_secret_access_key)"
  value       = aws_iam_access_key.app.secret
  sensitive   = true
}

output "rds_endpoint" {
  description = "RDS host:port"
  value       = aws_db_instance.this.endpoint
}

output "database_url" {
  description = "DATABASE_URL for Vercel (terraform output -raw database_url)"
  value       = "postgresql://${var.db_username}:${random_password.db.result}@${aws_db_instance.this.address}:5432/${var.db_name}?sslmode=require"
  sensitive   = true
}

# Convenience: the exact command to create the schema on the fresh database.
output "prisma_db_push_command" {
  description = "Run from the repo root once, to create the tables on the new RDS instance."
  value       = "DATABASE_URL=\"$(terraform -chdir=infra output -raw database_url)\" npx prisma db push"
}
