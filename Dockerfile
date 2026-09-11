# The engine image: the release archive unpacked onto the path, plus the
# DuckDB CLI the engine uses for SQL, tables and pipelines. The archive is
# copied at build time only; it is never in git.
FROM debian:bookworm-slim
ARG UNIDATUM_VERSION
ARG DUCKDB_URL=https://github.com/duckdb/duckdb/releases/latest/download/duckdb_cli-linux-amd64.zip
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl unzip \
 && rm -rf /var/lib/apt/lists/*
COPY unidatum-${UNIDATUM_VERSION}-linux-amd64.tar.gz /tmp/unidatum.tar.gz
RUN mkdir -p /opt/unidatum \
 && tar xzf /tmp/unidatum.tar.gz -C /opt/unidatum --strip-components=1 \
 && rm /tmp/unidatum.tar.gz \
 && ln -s /opt/unidatum/unidatum /usr/local/bin/unidatum \
 && ln -s /opt/unidatum/unidatum-sqld /usr/local/bin/unidatum-sqld \
 && ln -s /opt/unidatum/unidatum-kafka /usr/local/bin/unidatum-kafka \
 && curl -fsSL "$DUCKDB_URL" -o /tmp/duckdb.zip \
 && unzip -q /tmp/duckdb.zip -d /usr/local/bin && rm /tmp/duckdb.zip && chmod +x /usr/local/bin/duckdb \
 && unidatum version && duckdb --version \
 && duckdb -c "INSTALL spatial;" && ls /root/.duckdb/extensions/*/*/spatial.duckdb_extension
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh
WORKDIR /data
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
