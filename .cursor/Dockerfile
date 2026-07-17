FROM mcr.microsoft.com/devcontainers/base:ubuntu26.04

ENV NVM_DIR=/usr/local/share/nvm
ENV PATH=${NVM_DIR}/versions/node/v22.4.0/bin:${PATH}

RUN mkdir -p "${NVM_DIR}" && \
    curl --retry 3 --retry-delay 5 -fsSL "https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.5/install.sh" | PROFILE=/dev/null bash && \
    bash -c ". \"${NVM_DIR}/nvm.sh\" && nvm install 22.4.0"
