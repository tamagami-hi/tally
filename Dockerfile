# Git is built here, not taken from Debian: a repository can use a format
# extension that only a newer git reads, and a host on a rolling distribution
# has a newer git than Debian stable. Keep GIT_VERSION at or above the git on
# the machine that runs the agents, with the checksum kernel.org publishes.
FROM node:24-trixie-slim AS git
ARG GIT_VERSION=2.56.1
ARG GIT_SHA256=f0b0bf89264b9bd2e1c640363e7529643989da76281600473c50745cd34a607f
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl xz-utils gcc make libc6-dev zlib1g-dev \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /src
RUN curl -fsSL -o git.tar.xz "https://mirrors.edge.kernel.org/pub/software/scm/git/git-${GIT_VERSION}.tar.xz" \
  && echo "${GIT_SHA256}  git.tar.xz" | sha256sum -c - \
  && tar -xf git.tar.xz --strip-components=1 \
  && make -j"$(nproc)" prefix=/usr/local DESTDIR=/out INSTALL_SYMLINKS=1 \
    NO_CURL=1 NO_EXPAT=1 NO_GETTEXT=1 NO_TCLTK=1 NO_PERL=1 NO_PYTHON=1 NO_OPENSSL=1 NO_RUST=1 \
    all install

FROM node:24-trixie-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY packages/cli/package.json packages/cli/
COPY packages/mcp/package.json packages/mcp/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
RUN npm ci --no-audit --no-fund
COPY packages packages
RUN npm run build

FROM node:24-trixie-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends git git-lfs ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir /data \
  && chmod 0777 /data
WORKDIR /app
ENV NODE_ENV=production TALLY_HOME=/data HOME=/data
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/cli/package.json packages/cli/
COPY packages/mcp/package.json packages/mcp/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=git /out/usr/local/ /usr/local/
COPY --from=build /app/packages/core/dist packages/core/dist
COPY --from=build /app/packages/cli/dist packages/cli/dist
COPY --from=build /app/packages/mcp/dist packages/mcp/dist
COPY --from=build /app/packages/server/dist packages/server/dist
COPY --from=build /app/packages/web/dist packages/web/dist
USER node
EXPOSE 47560
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD ["node", "-e", "fetch('http://127.0.0.1:47560/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "packages/cli/dist/main.js", "serve", "--host", "0.0.0.0"]
