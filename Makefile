# Thin wrapper over the npm scripts in package.json. Run `make help`.
.DEFAULT_GOAL := help
.PHONY: help setup env secret dev build start lint lint-fix typecheck test test-watch \
        check-env verify verify-full \
        supabase-init supabase-start supabase-stop supabase-status supabase-login \
        supabase-link db-reset db-push db-new db-diff

help: ## Show this help
	@awk 'BEGIN {FS = ":.*## "} /^[a-zA-Z_-]+:.*## / {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

# --- Setup -------------------------------------------------------------------
setup: ## Install deps, create .env.local, init Supabase config
	npm run setup

env: ## Create .env.local from .env.example (never overwrites)
	npm run setup:env

secret: ## Print a random VAPI_TOOL_SIGNING_SECRET
	@npm run -s setup:secret

# --- App ---------------------------------------------------------------------
dev: ## Start the Next.js dev server
	npm run dev

build: ## Production build
	npm run build

start: ## Run the production build
	npm run start

# --- Verification ------------------------------------------------------------
lint: ## ESLint
	npm run lint

lint-fix: ## ESLint with --fix
	npm run lint:fix

typecheck: ## tsc --noEmit
	npm run typecheck

test: ## Run the vitest suite once
	npm run test

test-watch: ## Vitest in watch mode
	npm run test:watch

check-env: ## Verify required env vars (names only)
	npm run check:env

verify: ## lint + typecheck + test
	npm run verify

verify-full: ## check-env + verify + build
	npm run verify:full

# --- Supabase ----------------------------------------------------------------
supabase-init: ## Create supabase/config.toml if missing
	npm run supabase:init

supabase-start: ## Start the local Supabase stack (Docker)
	npm run supabase:start

supabase-stop: ## Stop the local Supabase stack
	npm run supabase:stop

supabase-status: ## Show local stack status and URLs
	npm run supabase:status

supabase-login: ## Log in to Supabase
	npm run supabase:login

supabase-link: ## Link a hosted project: make supabase-link REF=<project-ref>
	@test -n "$(REF)" || { echo "usage: make supabase-link REF=<project-ref>"; exit 1; }
	npm run supabase:link -- --project-ref $(REF)

db-reset: ## Reset local DB and re-apply migrations
	npm run db:reset

db-push: ## Push migrations to the linked hosted project
	npm run db:push

db-new: ## Create a migration: make db-new NAME=<name>
	@test -n "$(NAME)" || { echo "usage: make db-new NAME=<migration_name>"; exit 1; }
	npm run db:new -- $(NAME)

db-diff: ## Diff local DB against migrations
	npm run db:diff
