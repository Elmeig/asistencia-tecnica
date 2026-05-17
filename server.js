const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const XLSX = require("xlsx");

const PORT = 3001;
const DATA_FILE = path.join(__dirname, "data", "records.json");

// ===== DATA HELPERS =====
function readData() {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
}
function writeData(data) {
    const tmp = DATA_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
    fs.renameSync(tmp, DATA_FILE);
}

// ===== ROUTER =====
const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const pathname = url.pathname;
    const method = req.method;

    // GET / — serve HTML
    if (pathname === "/" && method === "GET") {
        serveFile(res, "index.html", "text/html");
        return;
    }

    // GET /app.js
    if (pathname === "/app.js" && method === "GET") {
        serveFile(res, "app.js", "application/javascript");
        return;
    }

    // GET /styles.css
    if (pathname === "/styles.css" && method === "GET") {
        serveFile(res, "styles.css", "text/css");
        return;
    }

    // GET /api/records — get all records (optionally filtered)
    if (pathname === "/api/records" && method === "GET") {
        const data = readData();
        let records = [...data.records];

        const client = url.searchParams.get("client");
        const machine = url.searchParams.get("machine");
        const tech = url.searchParams.get("tech");
        const dateFrom = url.searchParams.get("dateFrom");
        const dateTo = url.searchParams.get("dateTo");
        const q = url.searchParams.get("q");

        if (client) records = records.filter(r => r.client === client);
        if (machine) records = records.filter(r => r.machine === machine);
        if (tech) records = records.filter(r => r.tech === tech);
        if (dateFrom) records = records.filter(r => r.date >= dateFrom);
        if (dateTo) records = records.filter(r => r.date <= dateTo);
        if (q) {
            const ql = q.toLowerCase();
            records = records.filter(r =>
                (r.comments && r.comments.toLowerCase().includes(ql)) ||
                (r.client && r.client.toLowerCase().includes(ql)) ||
                (r.tech && r.tech.toLowerCase().includes(ql))
            );
        }

        // Sort newest first
        records.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
        jsonResponse(res, records);
        return;
    }

    // GET /api/clients — get clients structure
    if (pathname === "/api/clients" && method === "GET") {
        const data = readData();
        jsonResponse(res, { clients: data.clients, techs: data.techs });
        return;
    }

    // POST /api/records — add new record
    if (pathname === "/api/records" && method === "POST") {
        parseBody(req).then(body => {
            if (!body.client || !body.date) {
                jsonError(res, 400, "Cliente y fecha son obligatorios");
                return;
            }
            const data = readData();
            const record = {
                id: crypto.randomUUID(),
                client: body.client.trim(),
                machine: (body.machine || "").trim(),
                date: body.date.trim(),
                tech: (body.tech || "").trim(),
                comments: (body.comments || "").trim(),
                createdAt: new Date().toISOString().slice(0, 10)
            };
            data.records.push(record);

            // Update client-machine mapping
            if (!data.clients[record.client]) data.clients[record.client] = [];
            if (record.machine && !data.clients[record.client].includes(record.machine)) {
                data.clients[record.client].push(record.machine);
                data.clients[record.client].sort();
            }
            writeData(data);
            jsonOk(res, { id: record.id });
        });
        return;
    }

    // PUT /api/records/:id — update record
    if (pathname.startsWith("/api/records/") && method === "PUT") {
        const parts = pathname.split("/");
        const id = parts[3];
        parseBody(req).then(body => {
            const data = readData();
            const i = data.records.findIndex(r => r.id === id);
            if (i === -1) { jsonError(res, 404, "Registro no encontrado"); return; }
            data.records[i] = { ...data.records[i], ...body, comments: body.comments !== undefined ? (body.comments || "").trim() : data.records[i].comments };
            // Update machine mapping
            if (body.machine && body.client && data.clients[body.client]) {
                if (!data.clients[body.client].includes(body.machine)) {
                    data.clients[body.client].push(body.machine);
                    data.clients[body.client].sort();
                }
            }
            writeData(data);
            jsonOk(res);
        });
        return;
    }

    // DELETE /api/records/:id
    if (pathname.startsWith("/api/records/") && method === "DELETE") {
        const parts = pathname.split("/");
        const id = parts[3];
        const data = readData();
        data.records = data.records.filter(r => r.id !== id);
        writeData(data);
        jsonOk(res);
        return;
    }

    // GET /api/export — export to Excel (filtered)
    if (pathname === "/api/export" && method === "GET") {
        const data = readData();
        let records = [...data.records];

        const client = url.searchParams.get("client");
        const machine = url.searchParams.get("machine");
        const tech = url.searchParams.get("tech");
        const dateFrom = url.searchParams.get("dateFrom");
        const dateTo = url.searchParams.get("dateTo");

        if (client) records = records.filter(r => r.client === client);
        if (machine) records = records.filter(r => r.machine === machine);
        if (tech) records = records.filter(r => r.tech === tech);
        if (dateFrom) records = records.filter(r => r.date >= dateFrom);
        if (dateTo) records = records.filter(r => r.date <= dateTo);

        // Sort by date
        records.sort((a, b) => (a.date || "").localeCompare(b.date || ""));

        // Build Excel
        const ws = XLSX.utils.json_to_sheet(records.map((r, i) => ({
            "Nº": i + 1,
            "Cliente": r.client,
            "Máquina": r.machine,
            "Fecha": r.date,
            "Técnico": r.tech,
            "Comentarios": r.comments
        })));

        ws["!cols"] = [
            { wch: 6 }, { wch: 22 }, { wch: 18 }, { wch: 12 }, { wch: 18 }, { wch: 60 }
        ];

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Asistencias");

        const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

        res.writeHead(200, {
            "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "Content-Disposition": `attachment; filename="asistencias_${new Date().toISOString().slice(0, 10)}.xlsx"`,
            "Content-Length": buffer.length
        });
        res.end(buffer);
        return;
    }

    // 404
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
});

// ===== HELPERS =====
function serveFile(res, filename, contentType) {
    const filePath = path.join(__dirname, filename);
    if (!fs.existsSync(filePath)) {
        res.writeHead(404); res.end("File not found"); return;
    }
    const content = fs.readFileSync(filePath, "utf8");
    res.writeHead(200, { "Content-Type": contentType + "; charset=utf-8" });
    res.end(content);
}

function parseBody(req) {
    return new Promise((resolve, reject) => {
        let body = "";
        req.on("data", chunk => body += chunk);
        req.on("end", () => { try { resolve(JSON.parse(body)); } catch(e) { reject(e); } });
    });
}

function jsonOk(res, data) {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true, ...data }));
}
function jsonError(res, code, msg) {
    res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: false, error: msg }));
}
function jsonResponse(res, data) {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(data));
}

// ===== SERVER START =====
server.listen(PORT, "0.0.0.0", () => {
    console.log(`Asistencia Técnica Server Running on port ${PORT}`);
    console.log(`  Local: http://localhost:${PORT}`);
});
