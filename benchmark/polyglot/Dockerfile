FROM buildpack-deps:jammy

RUN apt-get update && apt-get install -y \
    ca-certificates-java \
    cmake \
    libboost-all-dev \
    libtbb-dev \
    openjdk-21-jdk \
    python3 \
    python3-pip \
    python3-pytest \
    unzip \
    && rm -rf /var/lib/apt/lists/*

RUN ARCH="$(uname -m)" && \
    if [ "$ARCH" = "x86_64" ]; then GOARCH="amd64"; \
    elif [ "$ARCH" = "aarch64" ]; then GOARCH="arm64"; \
    else echo "unsupported architecture: $ARCH" >&2; exit 1; fi && \
    curl -fsSL "https://go.dev/dl/go1.22.12.linux-$GOARCH.tar.gz" -o /tmp/go.tar.gz && \
    tar -C /usr/local -xzf /tmp/go.tar.gz && \
    rm /tmp/go.tar.gz
ENV PATH="/usr/local/go/bin:${PATH}"

RUN curl -fsSL https://sh.rustup.rs -o /tmp/rustup.sh && \
    chmod +x /tmp/rustup.sh && \
    /tmp/rustup.sh -y && \
    rm /tmp/rustup.sh
ENV PATH="/root/.cargo/bin:${PATH}"

RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/* && \
    mkdir -p /npm-install && \
    cd /npm-install && \
    npm init -y && \
    npm install \
      @babel/core@7.25.2 \
      @exercism/babel-preset-javascript@0.2.1 \
      @exercism/eslint-config-javascript@0.6.0 \
      @types/jest@29.5.12 \
      @types/node@20.12.12 \
      babel-jest@29.6.4 \
      core-js@3.37.1 \
      eslint@8.49.0 \
      jest@29.7.0

RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

WORKDIR /octofriend
