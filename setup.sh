#!/bin/bash

# Plane Project Setup Script
# This script prepares the local development environment by setting up all necessary .env files
# https://github.com/makeplane/plane

# Set colors for output messages
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Print header
echo -e "${BOLD}${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BOLD}${BLUE}                   Plane - Project Management Tool                    ${NC}"
echo -e "${BOLD}${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BOLD}Setting up your development environment...${NC}\n"

# Function to resolve one .env.schema into a .env file with varlock.
#
# varlock owns the tracked definition; this script only materializes the
# resolved values where the Docker tooling expects to find them. An existing
# .env is preserved, so local overrides are not reset.
resolve_env_file() {
    local directory=$1

    if [ ! -f "${directory}.env.schema" ]; then
        echo -e "${RED}Error: ${directory}.env.schema does not exist.${NC}"
        return 1
    fi

    if [ -f "${directory}.env" ]; then
        echo -e "${GREEN}✓${NC} Kept existing ${directory}.env"
        return 0
    fi

    if ! command -v varlock >/dev/null 2>&1; then
        echo -e "${RED}Error: varlock is not installed.${NC}"
        echo -e "${RED}Install it from https://varlock.dev before running setup.${NC}"
        return 1
    fi

    if varlock load --path "${directory}.env.schema" --format env --compact > "${directory}.env"; then
        echo -e "${GREEN}✓${NC} Resolved ${directory}.env from ${directory}.env.schema"
        return 0
    fi

    rm -f "${directory}.env"
    echo -e "${RED}✗${NC} Failed to resolve ${directory}.env.schema${NC}"
    return 1
}

# Export character encoding settings for macOS compatibility
export LC_ALL=C
export LC_CTYPE=C
echo -e "${YELLOW}Setting up environment files...${NC}"

# Resolve each .env from its tracked .env.schema
services=("" "web" "api" "space" "admin" "live")
success=true

for service in "${services[@]}"; do
    if [ "$service" == "" ]; then
        # Handle root .env file
        prefix="./"
    else
        # Handle service .env files in apps folder
        prefix="./apps/$service/"
    fi

    # Services without a schema are upstream-owned and not migrated yet.
    if [ ! -f "${prefix}.env.schema" ]; then
        echo -e "${YELLOW}•${NC} Skipped ${prefix}.env (no schema)"
        continue
    fi

    resolve_env_file "$prefix" || success=false
done

# Generate SECRET_KEY for Django
if [ -f "./apps/api/.env" ]; then
    echo -e "\n${YELLOW}Generating Django SECRET_KEY...${NC}"
    SECRET_KEY=$(tr -dc 'a-z0-9' < /dev/urandom | head -c50)

    if [ -z "$SECRET_KEY" ]; then
        echo -e "${RED}Error: Failed to generate SECRET_KEY.${NC}"
        echo -e "${RED}Ensure 'tr' and 'head' commands are available on your system.${NC}"
        success=false
    else
        echo -e "SECRET_KEY=\"$SECRET_KEY\"" >> ./apps/api/.env
        echo -e "${GREEN}✓${NC} Added SECRET_KEY to apps/api/.env"
    fi
else
    echo -e "${RED}✗${NC} apps/api/.env not found. SECRET_KEY not added."
    success=false
fi

# Activate pnpm (version set in package.json)
corepack enable pnpm || success=false
# Install Node dependencies
pnpm install || success=false

# Summary
echo -e "\n${YELLOW}Setup status:${NC}"
if [ "$success" = true ]; then
    echo -e "${GREEN}✓${NC} Environment setup completed successfully!\n"
    echo -e "${BOLD}Next steps:${NC}"
    echo -e "1. Review the .env files in each folder if needed"
    echo -e "2. Start the services with: ${BOLD}docker compose -f docker-compose-local.yml up -d${NC}"
    echo -e "\n${GREEN}Happy coding! 🚀${NC}"
else
    echo -e "${RED}✗${NC} Some issues occurred during setup. Please check the errors above.\n"
    echo -e "For help, visit: ${BLUE}https://github.com/makeplane/plane${NC}"
    exit 1
fi
