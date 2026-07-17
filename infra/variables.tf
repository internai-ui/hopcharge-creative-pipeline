variable "aws_region" {
  description = "AWS region. Default us-east-1 to sit next to Vercel's iad1 functions (low DB latency)."
  type        = string
  default     = "us-east-1"
}

variable "project" {
  description = "Name prefix / tag applied to all resources."
  type        = string
  default     = "hopcharge-creative-pipeline"
}

# ── S3 ────────────────────────────────────────────────────────────────────────
variable "s3_bucket_prefix" {
  description = "Prefix for the creatives bucket. A random suffix is appended so the final name is always globally unique (see the s3_bucket output)."
  type        = string
  default     = "hopcharge-creatives"
}

variable "s3_versioning" {
  description = "Keep old versions of overwritten/deleted objects (costs more storage)."
  type        = bool
  default     = false
}

# ── RDS ───────────────────────────────────────────────────────────────────────
variable "db_name" {
  description = "Initial Postgres database name."
  type        = string
  default     = "hopcharge"
}

variable "db_username" {
  description = "Postgres master username."
  type        = string
  default     = "hopcharge"
}

variable "db_instance_class" {
  description = "RDS instance class. db.t4g.micro is the cheapest Graviton option (free-tier eligible in most regions)."
  type        = string
  default     = "db.t4g.micro"
}

variable "db_allocated_storage" {
  description = "Storage in GB (gp3 minimum is 20)."
  type        = number
  default     = 20
}

variable "postgres_version" {
  description = "Postgres major version. Set a specific minor (e.g. 16.4) if you want to pin it."
  type        = string
  default     = "16"
}

variable "db_allowed_cidrs" {
  description = <<-EOT
    CIDRs allowed to reach Postgres on 5432. Vercel Hobby has no static egress IPs,
    so this defaults to open - the 32-char generated password + required TLS are the
    protection. Narrow it if all your DB clients have known IPs.
  EOT
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "db_backup_retention_days" {
  description = "Automated backup retention in days (0 disables backups)."
  type        = number
  default     = 7
}

variable "db_skip_final_snapshot" {
  description = "Skip the final snapshot on destroy (true = clean teardown, keeps no backup)."
  type        = bool
  default     = true
}

variable "db_deletion_protection" {
  description = "Block accidental `terraform destroy` of the database."
  type        = bool
  default     = false
}
