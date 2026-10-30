FROM node:24-bookworm-slim
WORKDIR /app
COPY --chown=node:node server ./server
COPY --chown=node:node shared ./shared
COPY --chown=node:node js/ai.js js/transcript.js ./js/
RUN mkdir /data && chown node:node /data
USER node
ENV NODE_ENV=production STUDIO_HOST=0.0.0.0 STUDIO_DATABASE=/data/studio.sqlite PORT=8787
EXPOSE 8787
VOLUME ["/data"]
CMD ["node", "server/index.cjs"]
