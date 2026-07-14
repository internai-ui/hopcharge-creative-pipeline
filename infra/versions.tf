terraform {
  required_version = ">= 1.5"

  required_providers {
    # Pinned to the versions this config was validated against, allowing only
    # backward-compatible patch releases. No committed lock file, so `init` fetches
    # the correct binaries for whatever OS runs it (Mac / Linux / Windows).
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.100, < 6.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.9"
    }
  }
}
