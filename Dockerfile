# Pinned Node 24 image manifest: https://mcr.microsoft.com/v2/devcontainers/javascript-node/manifests/sha256:1bc82e3350b0da52ca1a1b1b2e7527300bc6fdfd778287e0eed564203d66a68c
# https://mcr.microsoft.com/en-us/artifact/mar/devcontainers/javascript-node/tag/5.2.5-24-bookworm 
FROM mcr.microsoft.com/devcontainers/javascript-node:5.2.5-24-bookworm@sha256:1bc82e3350b0da52ca1a1b1b2e7527300bc6fdfd778287e0eed564203d66a68c

USER root
RUN corepack enable \
  && mkdir -p /workspaces/ResourceHunt/node_modules \
  && chown -R node:node /workspaces/ResourceHunt

WORKDIR /workspaces/ResourceHunt
USER node
