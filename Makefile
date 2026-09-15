.PHONY: setup verify build up up-local up-demo down ps logs

setup:
	./scripts/init_env.sh

verify:
	./scripts/verify.sh

build:
	./scripts/compose.sh --env-file .env build

up:
	./deploy.sh

up-local:
	./deploy.sh

up-demo:
	./scripts/compose.sh -f docker-compose.offline.yml --env-file .env up --build -d

down:
	./scripts/compose.sh --env-file .env --profile local-ai down
	./scripts/compose.sh -f docker-compose.offline.yml --env-file .env down

ps:
	./scripts/compose.sh --env-file .env --profile local-ai ps

logs:
	./scripts/compose.sh --env-file .env --profile local-ai logs -f --tail=200
