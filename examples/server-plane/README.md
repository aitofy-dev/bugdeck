# Standalone server, one file

```bash
cp ../../.env.example .env   # fill in the four PLANE_ values
pnpm start                   # http://localhost:3131
```

`server.ts` is all of it. `npx @aitofy/bugdeck-server` runs the same thing without the file.

Point the widget at it:

```tsx
<FeedbackWidget apiBase="http://localhost:3131" />
```

`AUTH_MODE=header` trusts `X-User-Id` / `X-User-Email`, so **run it behind your own authenticating
proxy**. Mounting the app inside a server you already have — with your own session check, in Hono or
in Express — is the other way round, and it is four lines: see
[`@aitofy/bugdeck-server`](../../packages/server/README.md#30-seconds).
