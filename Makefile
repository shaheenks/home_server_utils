CONFIG     ?=
AGENT_DIR  := /opt/status-agent
ETC_DIR    := /etc/status-agent
TOKEN_FILE := $(ETC_DIR)/power_token
SERVE_DIR  := public
SERVE_PORT := 8080

.DEFAULT_GOAL := help

.PHONY: help install token logs serve publish

help:
	@echo "Usage: make <target>"
	@echo ""
	@echo "  install CONFIG=config/<host>.json"
	@echo "                      Install/update the status agent as a systemd service on this host"
	@echo "  token               Generate a new power token (enables shutdown/reboot)"
	@echo "  logs                Follow the agent's logs"
	@echo "  serve               Serve the dashboard locally at http://localhost:$(SERVE_PORT)"
	@echo "                        Override port: make serve SERVE_PORT=9000"
	@echo "  publish             Deploy the dashboard (public/) to Cloudflare Workers"
	@echo ""

install:
	@test -n "$(CONFIG)" || { echo "Set CONFIG, e.g. make install CONFIG=config/pi.json"; exit 1; }
	id -u status-agent >/dev/null 2>&1 || sudo useradd --system --no-create-home --shell /usr/sbin/nologin status-agent
	if getent group libvirt >/dev/null; then sudo usermod -aG libvirt status-agent; fi
	sudo install -d -m 755 $(AGENT_DIR)
	sudo install -d -m 750 -g status-agent $(ETC_DIR)
	sudo install -m 755 agent/agent.py $(AGENT_DIR)/agent.py
	sudo install -m 640 -g status-agent $(CONFIG) $(ETC_DIR)/config.json
	sudo visudo -cf deploy/status-agent.sudoers
	sudo install -m 440 deploy/status-agent.sudoers /etc/sudoers.d/status-agent
	sudo install -m 644 deploy/status-agent.service /etc/systemd/system/status-agent.service
	sudo systemctl daemon-reload
	sudo systemctl enable status-agent
	sudo systemctl restart status-agent
	@sleep 1; curl -fsS http://127.0.0.1:8765/ping && echo "" && echo "Installed. Now add deploy/apache.conf or deploy/nginx.conf to the HTTPS site."

token:
	@python3 -c 'import secrets; print(secrets.token_urlsafe(32))' | sudo tee $(TOKEN_FILE) >/dev/null
	@sudo chown root:status-agent $(TOKEN_FILE) && sudo chmod 640 $(TOKEN_FILE)
	@sudo systemctl restart status-agent
	@echo "New power token (save it in your password manager):"
	@sudo cat $(TOKEN_FILE)

logs:
	journalctl -u status-agent -f

serve:
	@echo "Serving $(SERVE_DIR) at http://localhost:$(SERVE_PORT)"
	python3 -m http.server $(SERVE_PORT) --directory $(SERVE_DIR)

publish:
	npx wrangler deploy
