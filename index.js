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

app.use(cors());
app.use(express.json({ limit: "2mb" }));
const { router: uploadRoutes, uploadDir } = require('./src/routes/upload.routes');
app.use('/api/uploads', uploadRoutes);
app.use('/api/uploads', express.static(uploadDir, { index: false, dotfiles: 'deny', maxAge: '1y', immutable: true, setHeaders: res => res.setHeader('X-Content-Type-Options', 'nosniff') }));

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

if (require.main === module)
  app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
module.exports = app;
