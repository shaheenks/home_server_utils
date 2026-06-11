CGI_SRC    := cgi
CGI_DEST   := /usr/lib/cgi-bin
SCRIPTS    := status.cgi ping.cgi
SERVE_DIR  := landing_page
SERVE_PORT := 8080

.DEFAULT_GOAL := help

.PHONY: help deploy serve

help:
	@echo "Usage: make <target>"
	@echo ""
	@echo "  deploy              Copy CGI scripts to $(CGI_DEST), set permissions, reload Apache"
	@echo "  serve               Serve landing_page/ locally at http://localhost:$(SERVE_PORT)"
	@echo "                        Override port: make serve SERVE_PORT=9000"
	@echo ""

deploy:
	sudo cp $(addprefix $(CGI_SRC)/, $(SCRIPTS)) $(CGI_DEST)/
	sudo chmod +x $(addprefix $(CGI_DEST)/, $(SCRIPTS))
	sudo systemctl reload apache2
	@echo "Deployed: $(SCRIPTS) → $(CGI_DEST)"

serve:
	@echo "Serving $(SERVE_DIR) at http://localhost:$(SERVE_PORT)"
	python3 -m http.server $(SERVE_PORT) --directory $(SERVE_DIR)
