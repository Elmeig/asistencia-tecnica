# Registro Asistencia Técnica

Aplicación web para registrar y gestionar asistencias técnicas.

## 🚀 Acceso online

**URL:** `https://bugtracker.tail51f3b0.ts.net/asistencia/`

## 📦 Stack

- **Backend:** Node.js vanilla (sin frameworks)
- **Frontend:** HTML, CSS, JavaScript vanilla
- **Datos:** JSON file (`data/records.json`)
- **Proxy inverso:** Node.js en puerto 3002 enruta `/asistencia/*` al puerto 3001

## 🎯 Tareas de mejora pendientes

### Objetivo principal
Mejorar la estética para que se parezca al Bug Tracker y sea completamente responsive (móvil, tablet, escritorio).

### Directrices de diseño

#### 1. Responsive
- Debe verse bien en **móvil** (320px+), **tablet** (768px+) y **escritorio** (1024px+)
- Touch-friendly en móvil: botones grandes, spacing adecuado
- Sidebar debe funcionar como drawer en móvil y panel lateral en escritorio

#### 2. Estética coherente con Bug Tracker
- Mismo esquema de colores, tipografías y estilo visual
- Tema oscuro por defecto (como Bug Tracker)
- Bordes, sombras y transiciones consistentes

#### 3. Campos de comentarios grandes
- Los comentarios deben ser **muy legibles** — fuente grande, buen contraste
- Espacio suficiente para lectura cómoda de textos largos
- Expansible o con scroll interno si es muy largo

#### 4. Etiquetas de filtro (cliente, técnico, máquina, fecha)
- **Pequeñas pero visibles** — tamaño reducido pero no diminutas
- Funcionales como filtros de búsqueda
- Exportables a Excel
- Estilo badge/tag coherente

## 🏗️ Estructura

```
├── server.js           # API REST (puerto 3001)
├── app.js              # Frontend JavaScript
├── styles.css          # Estilos CSS
├── index.html          # HTML principal
├── package.json        # Dependencias (xlsx para exportar Excel)
├── data/
│   └── records.json    # Datos de registros (844 registros)
└── README.md           # Este archivo
```

## 📐 Arquitectura de red

```
Internet → Tailscale Funnel (puerto 443)
                ↓
        Proxy inverso (puerto 3002)
        ├── /              → Bug Tracker (puerto 3000)
        └── /asistencia/*  → Asistencia Técnica (puerto 3001)
```

## 🔧 Desarrollo local

```bash
cd asistencia-tecnica
npm install
node server.js
# Server en http://localhost:3001
```

## 👨‍💻 Desarrollador

Proyecto mantenido por **Jaime**
