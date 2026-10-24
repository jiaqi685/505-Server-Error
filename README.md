# NGate — AI-Assisted Inventory & Procurement Dashboard

> An AI-assisted dashboard that helps small retailers monitor stock, plan replenishment, manage supplier quotations, compare offers, and prepare purchase orders more efficiently.

---

## Team Information

| Field | Details |
| --- | --- |
| **Team Name** | 505 Server Error |
| **Hackathon Domain** | Domain 2 |
| **SDG Track** | SDG 9 — Industry, Innovation and Infrastructure |
| **Institution** | Universiti Malaysia Perlis (UniMAP) |
| **Number of Members** | 5 |

## Team Members

- **Melissa Ting Jia Jie** — Team Leader
- **Tan Jia Qi**
- **Lee Wan Yee**
- **Cindy Wu Wen Xin**
- **Cheng Jia Yi**

---

## Links

| Resource | Link |
| --- | --- |
| **GitHub Repository** | This repository |
| **Live Demo** | https://n-gate-pos-v-5.replit.app/ngate/ |
| **Slide Deck** | Included in the official hackathon submission package |
| **Demo Video** | Included in the official hackathon submission package |

---

## Overview

### Problem
Small retailers and mini marts often manage inventory and purchasing manually through spreadsheets, chat messages, and paper-based supplier quotations. This makes it hard to detect low-stock situations early, estimate replenishment needs accurately, and compare supplier offers efficiently. As a result, businesses may face stockouts, slower purchasing decisions, and avoidable procurement errors.

### Solution
NGate is an AI-assisted inventory and procurement dashboard designed to support smarter purchasing decisions for small retail businesses. It combines POS-driven inventory visibility, replenishment recommendations, quotation extraction, supplier comparison, and purchase-order support within one connected workflow.

### Key Features
- **Inventory Visibility Dashboard** — Highlights low-stock items and summarizes sales and lead-time signals.
- **POS Import & Demand Tracking** — Uses imported POS and stock snapshots to support replenishment decisions.
- **Smart Replenishment Support** — Suggests reorder quantities based on changing demand signals.
- **Quotation Upload & AI Extraction** — Extracts structured supplier quotation data from uploaded documents.
- **Supplier Comparison** — Compares price, MOQ, delivery lead time, and total cost.
- **Purchase Order Workflow** — Supports purchase-order preparation and order tracking.
- **Activity History** — Keeps procurement actions traceable within the dashboard.

### Tech Stack

| Layer | Technology |
| --- | --- |
| **Frontend** | React, Vite, TypeScript |
| **API Server** | Node.js, Express, TypeScript |
| **Backend Service** | Python, Flask |
| **Database** | SQLite |
| **AI Integration** | Google Gemini API |
| **Hosting / Development** | Replit |

---

## Project Structure

```text
.
├── artifacts/
│   ├── ngate/                 # React dashboard frontend
│   │   ├── public/
│   │   └── src/
│   ├── api-server/            # Node.js / Express API server
│   │   └── src/
│   └── ngate-backend/         # Flask backend service for procurement flows
│       ├── app.py
│       └── requirements.txt
├── lib/                       # Shared API contracts and reusable libraries
├── scripts/                   # Project utility and support scripts
├── .env.example               # Example environment variables
├── .gitignore
├── .replit                    # Replit configuration
├── package.json               # Workspace configuration
├── pnpm-lock.yaml             # Dependency lock file
└── README.md
```

The repository contains multiple services because NGate is implemented as a connected dashboard system rather than a single-page prototype.

---

## Architecture

```text
User
  │
  ▼
NGate React Dashboard (artifacts/ngate)
  │
  ▼
Node.js / Express API Server (artifacts/api-server)
  │
  ├── AI quotation extraction via Gemini
  │
  └── Procurement service integration
       ▼
   Flask Backend + SQLite (artifacts/ngate-backend)
```

---

## Main Workflow Demonstrated

1. View the dashboard and identify low-stock items.
2. Import POS and stock data to update demand visibility.
3. Review replenishment recommendations for selected products.
4. Create quotation requests to multiple suppliers.
5. Upload supplier quotation documents for AI-assisted extraction.
6. Review extracted quotation data and compare supplier offers.
7. Prepare purchase orders and review activity history.

---

## How to Run

### Option 1 — Run on Replit
1. Import this repository into Replit.
2. Configure the required environment variables using Replit Secrets.
3. Install workspace dependencies with **pnpm**.
4. Start the project using the configured Replit workflow / run settings.
5. Open the NGate dashboard from the generated preview URL.

### Option 2 — Run Locally
1. Install **Node.js**, **pnpm**, and **Python 3**.
2. Clone the repository.
3. Install workspace dependencies:
   ```bash
   pnpm install
   ```
4. Configure environment variables based on `.env.example`.
5. Start the frontend / API services from the workspace and ensure the Flask backend dependencies in `artifacts/ngate-backend/requirements.txt` are installed.

> Note: This project is structured as a multi-service workspace. The frontend, API server, and Flask procurement backend work together as one system.

---

## Security Notes

- Real API keys and secrets are **not** included in this repository.
- Example environment configuration is provided through `.env.example`.
- SQLite database files and local development artifacts should not be committed to the public repository.

---

## Replit Usage

This project was developed and tested in Replit. Replit was used for collaborative development, previewing the dashboard, and hosting the published live demo link.

---

## Challenges & Learnings

### Challenges
- Coordinating a multi-service architecture across frontend, API, and backend layers.
- Handling quotation documents with inconsistent supplier formatting.
- Making procurement comparison outputs understandable for business users.

### Learnings
- AI is most useful when paired with human review in operational workflows.
- A connected inventory-to-procurement pipeline improves visibility and decision speed.
- Clear dashboard presentation is essential for non-technical end users.

---

## Future Improvements

- Improve production deployment stability across all services.
- Expand demand forecasting with richer historical sales patterns.
- Add stronger validation and automation for procurement workflows.
- Enhance supplier analytics and quotation standardization.

---

## License

This repository is submitted for hackathon evaluation and educational demonstration purposes.
