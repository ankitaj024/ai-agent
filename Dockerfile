# --- STAGE 1: Builder ---
    FROM node:20-slim AS builder

    WORKDIR /app
    
    # Install build dependencies
    COPY package*.json ./
    RUN npm install
    
    # Copy source and build TypeScript
    COPY . .
    RUN npm run build
    
    # --- STAGE 2: Runner ---
    FROM node:20-slim
    
    WORKDIR /app
    
    # Install system tools the Agent needs
    # sox: for voice | git: for version control | python3: often needed for dev tasks
    RUN apt-get update && apt-get install -y \
        sox \
        libsox-fmt-all \
        git \
        python3 \
        && rm -rf /var/lib/apt/lists/*
    
    # Install only production dependencies
    COPY package*.json ./
    RUN npm install --only=production
    
    # Copy built files from builder stage
    COPY --from=builder /app/dist ./dist
    
    # Create a workspace directory for mounting user projects
    WORKDIR /workspace
    
    # Link the global command (optional, but good for internal consistency)
    RUN npm link /app
    
    # Set the entrypoint
    ENTRYPOINT ["node", "/app/dist/index.js"]