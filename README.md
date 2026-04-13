# E-Commerce Profit Matrix

Spend × Efficiency × LTV profit analysis tool for e-commerce brands.

## Local Development

```bash
npm install
npm run dev
```

Opens at `http://localhost:5173`

## Deploy to Vercel (Recommended — Free)

### Option A: GitHub + Vercel (best for ongoing updates)

1. Create a new repo on GitHub
2. Push this project:
   ```bash
   git init
   git add .
   git commit -m "initial commit"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/profit-matrix.git
   git push -u origin main
   ```
3. Go to [vercel.com](https://vercel.com) → Sign up with GitHub
4. Click **"Add New Project"** → Import your repo
5. Vercel auto-detects Vite — just click **Deploy**
6. You get a live URL like `profit-matrix.vercel.app`

### Option B: Vercel CLI (fastest, no GitHub needed)

```bash
npm i -g vercel
vercel
```

Follow the prompts. Done in 60 seconds.

## Other Hosting Options

- **Netlify**: Drag the `dist/` folder (after `npm run build`) to [app.netlify.com/drop](https://app.netlify.com/drop)
- **Cloudflare Pages**: Connect GitHub repo, set build command to `npm run build`, output dir to `dist`
- **GitHub Pages**: `npm run build`, then deploy `dist/` folder

## Custom Domain

All platforms above support custom domains. Add a CNAME record pointing to your deployment URL in your DNS settings.
