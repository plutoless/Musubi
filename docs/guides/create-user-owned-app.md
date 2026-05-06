# Create a User-owned App

Start the relay, then create a local app identity:

```sh
go run ./cmd/musubi app create "My Automation" \
  --server http://127.0.0.1:8787 \
  --home .musubi/m3 \
  --workspace ws_local \
  --type user_owned \
  --generate-key-local \
  --env
```

The CLI prints SDK environment variables and writes local app config under `.musubi/m3/apps/`. The app private key is generated locally. The relay receives only the app public key and stores only a hash of the API key.

After creation, open the control plane Apps page and create a grant for the exact device and plugin channels the app may request.
