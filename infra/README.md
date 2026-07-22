# infra - AWS provisioning (Terraform)

Stands up everything the app needs on AWS, in **one `terraform apply`**, in a
**dedicated VPC** (no reliance on a default VPC), in **us-east-1** by default (next
to Vercel's `iad1` functions):

- **VPC + public subnets + internet gateway** (self-contained networking).
- **S3 bucket** (private) for generated creatives + an **IAM user** scoped to just
  that bucket. Bucket name gets a random suffix so it's always globally unique.
- **RDS PostgreSQL** (public, TLS) with a generated 32-char password.

> This is meant to be run by whoever holds AWS credentials. It needs **no input** -
> just `init` then `apply`. When it finishes, send back the one `env_for_vercel`
> block (last section) and you're done.

## Prerequisites (for whoever runs it)

- [Terraform](https://developer.hashicorp.com/terraform/install) ≥ 1.5 (tested on 1.9).
- AWS credentials in the shell (`aws configure`, or `AWS_ACCESS_KEY_ID` /
  `AWS_SECRET_ACCESS_KEY` env vars) for an identity allowed to create: **VPC,
  subnets, internet gateway, route tables, security groups, S3, IAM user/policy/
  access key, and RDS**. An account admin has all of these.
- Nothing else - no variables need to be set (defaults are sensible).

## Run it

```bash
cd infra
terraform init
terraform apply     # review the plan, type "yes". RDS takes ~5–10 min to create.
```

That's the whole deployment. There is nothing to configure first.

## Send this back

After `apply` completes, run:

```bash
terraform output -raw env_for_vercel
```

It prints a ready-to-paste block like:

```
STORAGE_TYPE=s3
AWS_S3_BUCKET=hopcharge-creatives-1a2b3c4d
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
DATABASE_URL=postgresql://hopcharge:...@...rds.amazonaws.com:5432/hopcharge?sslmode=require
```

Paste that block into **Vercel → Settings → Environment Variables**. These six values
are everything the app needs **from AWS** (S3 storage + the database). The Meta,
YouTube, and Google sign-in variables are configured separately (see the repo's
`.env.example`) - this stack does not touch them.

## One more step: create the database tables

The database comes up empty. Create the schema once (run from the repo root). Terraform
can fill in the real `DATABASE_URL` for you, so nothing secret is copy-pasted:

```bash
DATABASE_URL="$(terraform -chdir=infra output -raw database_url)" npx prisma db push
```

(`terraform -chdir=infra output -raw prisma_db_push_command` prints this exact line.)
Re-run the same command after any future schema change - it is safe to run repeatedly.

## Notes

- **Security:** the DB is publicly reachable because Vercel Hobby has no static
  egress IPs to allow-list. It's protected by a 32-char random password + required
  TLS (`sslmode=require`). To lock it down, set `db_allowed_cidrs` in a
  `terraform.tfvars` before applying.
- **Cost:** `db.t4g.micro` + 20 GB is free-tier-eligible for 12 months in most
  regions, ~$12–15/mo after. S3 is a few cents per GB. The VPC/IGW/subnets are free.
- **State:** `terraform.tfstate` holds the DB password + access key in plaintext -
  it's gitignored. For a team, move state to an S3 backend.
- **Tear down:** `terraform destroy` (with the default `db_skip_final_snapshot =
  true` this deletes the DB with no backup - set it to `false` first to keep one).

## Variables

All optional - see `variables.tf`. Common ones: `aws_region`, `s3_bucket_prefix`,
`db_instance_class`, `db_allowed_cidrs`, `db_deletion_protection`.
