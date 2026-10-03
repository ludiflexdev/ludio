FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=5173

COPY --chown=node:node package.json server.mjs voices.mjs studio-api.mjs speech-options.mjs timestamps.mjs deployment.mjs ./
COPY --chown=node:node public/ ./public/

USER node
EXPOSE 5173
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node --input-type=module -e "const r=await fetch('http://127.0.0.1:'+process.env.PORT+'/healthz',{signal:AbortSignal.timeout(4000)});process.exit(r.ok?0:1)"

CMD ["node", "server.mjs"]
