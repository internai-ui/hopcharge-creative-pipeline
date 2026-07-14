# infra — AWS provisioning (Terraform)

Provisions the two pieces of AWS the app needs:

- **S3 bucket** (private) for generated creatives, plus an **IAM user** with read/write access to just that bucket (its access key/secret are outputs).
- **RDS PostgreSQL** instance (public, TLS) with a generated password. The ready-to-use `DATABASE_URL` is an output.

Everything lands in your account's **default VPC** (no custom networking), in **us-east-1** by default so the database sits next to Vercel's `iad1` functions.

## Prerequisites

- [Terraform](https://developer.hashicorp.com/terraform/install) ≥ 1.5
- AWS credentials with permission to create S3/IAM/RDS/EC2-SG resources, e.g.:
  ```bash
  export AWS_ACCESS_KEY_ID=...
  export AWS_SECRET_ACCESS_KEY=...
  # or: aws configure
  ```

## Deploy

```bash
cd infra
cp terraform.tfvars.example terraform.tfvars   # edit s3_bucket_name to something globally unique
terraform init
terraform plan       # review
terraform apply      # type "yes" (RDS takes ~5–10 min to come up)
```

## Wire it into Vercel

After `apply`, read the outputs and set these in **Vercel → Settings → Environment Variables** (Production + Preview):

```bash
terraform output s3_bucket                    # → AWS_S3_BUCKET
terraform output aws_region                   # → AWS_REGION
terraform output aws_access_key_id            # → AWS_ACCESS_KEY_ID
terraform output -raw aws_secret_access_key   # → AWS_SECRET_ACCESS_KEY   (sensitive)
terraform output -raw database_url            # → DATABASE_URL            (sensitive)
```

Also set `STORAGE_TYPE=s3` and leave **`AWS_S3_ENDPOINT` unset** (that var is only for R2/MinIO; real S3 needs no endpoint).

## Create the database schema

The DB comes up empty. From the **repo root**, create the tables once (this project uses `db push`, not migrations):

```bash
DATABASE_URL="$(terraform -chdir=infra output -raw database_url)" npx prisma db push
# optional seed data:
DATABASE_URL="$(terraform -chdir=infra output -raw database_url)" npm run db:seed
```

## Notes & costs

- **Security:** the DB is publicly reachable because Vercel Hobby has no static egress IPs to allow-list. It's protected by a 32-char random password and `sslmode=require`. Narrow `db_allowed_cidrs` in `terraform.tfvars` if your clients have fixed IPs.
- **Cost:** `db.t4g.micro` + 20 GB is free-tier-eligible for 12 months in most regions, ~$12–15/mo after. S3 is a few cents/GB.
- **State:** `terraform.tfstate` holds the DB password and access key in plaintext — it's gitignored. For a team, move it to an S3 backend.

## Tear down

```bash
terraform destroy
```

With the defaults (`db_skip_final_snapshot = true`) this deletes the database **without a backup**. Set `db_skip_final_snapshot = false` first if you want a snapshot kept.
