FROM node:18-alpine

# Install openssh client tools needed for remote terminal commands
RUN apk add --no-cache openssh-client ruby ruby-json

WORKDIR /app

# Copy package dependencies
COPY package*.json ./

# Install npm production dependencies
RUN npm ci --only=production

# Copy application files
COPY server.js ./
COPY .env ./
COPY public/ ./public/

# Setup SSH folder permissions inside the container
RUN mkdir -p /root/.ssh && chmod 700 /root/.ssh

EXPOSE 3333

# Start server
CMD ["node", "server.js"]
