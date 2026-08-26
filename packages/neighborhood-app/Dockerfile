FROM node:22-alpine
WORKDIR /app
COPY packages/neighborhood-app/server.mjs .
COPY packages/neighborhood-app/public ./public
ENV PORT=4016 HOST=0.0.0.0 DATA_DIR=/data
EXPOSE 4016
CMD ["node", "server.mjs"]
