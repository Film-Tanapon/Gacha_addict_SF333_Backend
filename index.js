require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("node:path");

const { errorHandler } = require("./src/middleware/error.middleware");
const authRoutes = require("./src/routes/auth.routes");
const userRoutes = require("./src/routes/user.routes");
const cardRoutes = require("./src/routes/card.routes");
const resultRoutes = require("./src/routes/result.routes");

const app = express();
const PORT = process.env.PORT || 3000;
const proxyHops = Number(process.env.TRUST_PROXY_HOPS || 0);
if (!Number.isInteger(proxyHops) || proxyHops < 0 || proxyHops > 5) throw new Error('Invalid TRUST_PROXY_HOPS');
if (proxyHops) app.set('trust proxy', proxyHops);

app.use(cors());
app.use(require('./src/routes/privacy.routes'));
app.use(express.json({ limit: "2mb" }));
const { router: uploadRoutes, uploadDir } = require('./src/routes/upload.routes');
app.use('/api/uploads', uploadRoutes);
app.use('/api/uploads', express.static(uploadDir, { index: false, dotfiles: 'deny', cacheControl: false, setHeaders: res => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
} }));

app.get("/", (req, res) => {
  res.json({ message: "GachaAddict backend is running" });
});

app.get(["/admin", "/index.html"], (req,res) => res.sendFile(path.join(__dirname,"index.html")));
app.use("/api/admin", require("./src/routes/admin.routes").router);
app.use("/api/auth", authRoutes);
app.use("/api/backup", require("./src/routes/backup.routes"));
app.use("/api/users", userRoutes);
app.use("/api/cards", cardRoutes); // includes nested /api/cards/:cardId/items and /pull
app.use("/api/results", resultRoutes);

app.use("/api", require("./src/routes/app.routes"));

app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.use(errorHandler);

if (require.main === module) {
  const stopCleanup = require('./src/services/accountDeletion.service').startDeletionWorker();
  const stopBackups = require('./src/services/backupRetention.service').startBackupWorker();
  const stopPasswordReset = require('./src/services/passwordReset.service').startWorker();
  const server = app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
  server.on('close', stopCleanup);
  server.on('close', stopBackups);
  server.on('close', stopPasswordReset);
}
module.exports = app;
