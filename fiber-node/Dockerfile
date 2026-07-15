FROM nervos/fiber:0.9.0-rc7

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates socat \
  && rm -rf /var/lib/apt/lists/*

COPY fiber-node/config.yml /usr/local/share/fiber-ir/config.yml
COPY fiber-node/entrypoint.sh /usr/local/bin/fiber-ir-node-entrypoint.sh

RUN chmod +x /usr/local/bin/fiber-ir-node-entrypoint.sh

EXPOSE 8228 18227

ENTRYPOINT ["fiber-ir-node-entrypoint.sh"]
