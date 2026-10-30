
import { useEffect, useState } from "react";
import { PayPalScriptProvider, PayPalButtons } from "@paypal/react-paypal-js";
import "./App.css";
const API = "http://127.0.0.1:8000";

function App() {
  const match = window.location.pathname.match(/^\/pay\/([^/]+)\/?$/);

  if (match) {
    return (
      <PayPalScriptProvider
        options={{
          "client-id": import.meta.env.VITE_PAYPAL_CLIENT_ID,
          currency: "USD",
          intent: "capture"
        }}
      >
        <ClientPaymentPage token={decodeURIComponent(match[1])} />
      </PayPalScriptProvider>
    );
  }

  return <FreelancerDashboard />;
}

function FreelancerDashboard() {
  const [page, setPage] = useState("Dashboard");
  const [dashboard, setDashboard] = useState(null);
  const [clients, setClients] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [showClientForm, setShowClientForm] = useState(false);
  const [editingClientId, setEditingClientId] = useState(null);
  const [showInvoiceForm, setShowInvoiceForm] = useState(false);

  // Client form
  const [clientForm, setClientForm] = useState({
    name: "",
    email: "",
    company: "",
    phone: ""
  });

  // Manual invoice form
  const [invoiceForm, setInvoiceForm] = useState({
    client_id: "",
    issue_date: new Date().toISOString().slice(0, 10),
    due_date: "",
    items: [
    {
      description: "",
      quantity: 1,
      unit_price: ""
    }
  ]
  });

  // AI invoice generator state
  const [workDescription, setWorkDescription] = useState("");
  const [aiItems, setAiItems] = useState([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");
  const [aiSaving, setAiSaving] = useState(false);

  const [aiInvoiceForm, setAiInvoiceForm] = useState({
    client_id: "",
    issue_date: new Date().toISOString().slice(0, 10),
    due_date: ""
  });

  // API request helper
  async function request(url, options = {}) {
    const response = await fetch(`${API}${url}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers
      }
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        typeof data.detail === "string"
          ? data.detail
          : "Something went wrong"
      );
    }

    return data;
  }

  // Load dashboard, clients and invoices
  async function loadData() {
    try {
      setError("");

      const [dashboardData, clientsData, invoicesData] =
        await Promise.all([
          request("/api/dashboard"),
          request("/api/clients"),
          request("/api/invoices")
        ]);

      setDashboard(dashboardData);
      setClients(clientsData);
      setInvoices(invoicesData);

    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  // Add client
  async function addClient(event) {
    event.preventDefault();

    try {
      await request("/api/clients", {
        method: "POST",
        body: JSON.stringify(clientForm)
      });

      setClientForm({
        name: "",
        email: "",
        company: "",
        phone: ""
      });

      setShowClientForm(false);
      await loadData();

    } catch (err) {
      alert(err.message);
    }
  }
// Edit client
function startEditClient(client) {
  setClientForm({
    name: client.name || "",
    email: client.email || "",
    company: client.company || "",
    phone: client.phone || ""
  });

  setEditingClientId(client.id);
  setShowClientForm(true);
}

// Update client
async function updateClient(event) {
  event.preventDefault();

  try {
    await request(`/api/clients/${editingClientId}`, {
      method: "PUT",
      body: JSON.stringify(clientForm)
    });

    setClientForm({
      name: "",
      email: "",
      company: "",
      phone: ""
    });

    setEditingClientId(null);
    setShowClientForm(false);

    await loadData();

    alert("Client updated successfully!");

  } catch (err) {
    alert(err.message);
  }
}

// Delete client
async function deleteClient(client) {
  const confirmed = window.confirm(
    `Are you sure you want to delete ${client.name}?`
  );

  if (!confirmed) {
    return;
  }

  try {
    await request(`/api/clients/${client.id}`, {
      method: "DELETE"
    });

    await loadData();

    alert("Client deleted successfully!");

  } catch (err) {
    alert(err.message);
  }
}
// Add a new manual invoice item
function addManualItem() {
  setInvoiceForm((previous) => ({
    ...previous,
    items: [
      ...previous.items,
      {
        description: "",
        quantity: 1,
        unit_price: ""
      }
    ]
  }));
}

// Update a manual invoice item
function updateManualItem(index, field, value) {
  setInvoiceForm((previous) => ({
    ...previous,
    items: previous.items.map((item, i) =>
      i === index
        ? { ...item, [field]: value }
        : item
    )
  }));
}

// Remove a manual invoice item
function removeManualItem(index) {
  setInvoiceForm((previous) => ({
    ...previous,
    items: previous.items.filter((item, i) => i !== index)
  }));
}

// Calculate manual invoice total
const manualTotal = invoiceForm.items.reduce(
  (total, item) =>
    total +
    Number(item.quantity || 0) *
    Number(item.unit_price || 0),
  0
);
  // Create manual invoice
  // Create manual invoice
async function addInvoice(event) {
  event.preventDefault();

  if (
    invoiceForm.items.length === 0 ||
    invoiceForm.items.some(
      (item) =>
        !item.description.trim() ||
        !Number.isFinite(Number(item.quantity)) ||
        Number(item.quantity) <= 0 ||
        item.unit_price === "" ||
        !Number.isFinite(Number(item.unit_price)) ||
        Number(item.unit_price) < 0
    )
  ) {
    alert("Please enter valid details for all invoice items.");
    return;
  }

  if (invoiceForm.due_date < invoiceForm.issue_date) {
    alert("Due date cannot be earlier than issue date.");
    return;
  }

  try {
    await request("/api/invoices", {
      method: "POST",
      body: JSON.stringify({
        client_id: Number(invoiceForm.client_id),
        issue_date: invoiceForm.issue_date,
        due_date: invoiceForm.due_date,
        items: invoiceForm.items.map((item) => ({
          description: item.description.trim(),
          quantity: Number(item.quantity),
          unit_price: Number(item.unit_price)
        }))
      })
    });

    setInvoiceForm({
      client_id: "",
      issue_date: new Date().toISOString().slice(0, 10),
      due_date: "",
      items: [
        {
          description: "",
          quantity: 1,
          unit_price: ""
        }
      ]
    });

    setShowInvoiceForm(false);

    await loadData();
    setPage("Invoices");

  } catch (err) {
    alert(err.message);
  }
}

  // Generate invoice items using Gemini AI
  async function generateAIInvoice(event) {
    event.preventDefault();

    setAiLoading(true);
    setAiError("");
    setAiItems([]);

    try {
      const result = await request("/api/ai/generate-invoice", {
        method: "POST",
        body: JSON.stringify({
          work_description: workDescription.trim()
        })
      });

      if (!Array.isArray(result.items) || result.items.length === 0) {
        throw new Error("AI did not return any invoice items. Try again.");
      }

      setAiItems(
        result.items.map((item, index) => ({
          id: index + 1,
          description: item.description || "",
          quantity: item.quantity ?? 1,
          unit_price: 0
        }))
      );

    } catch (err) {
      setAiError(err.message);
    } finally {
      setAiLoading(false);
    }
  }

  // Edit AI-generated invoice items
  function updateAIItem(id, field, value) {
    setAiItems((previousItems) =>
      previousItems.map((item) =>
        item.id === id
          ? { ...item, [field]: value }
          : item
      )
    );
  }

  // Save AI-generated invoice
  async function createAIInvoice(event) {
    event.preventDefault();

    if (aiItems.length === 0) {
      alert("Please generate invoice items first.");
      return;
    }

    if (
      aiItems.some(
        (item) =>
          !item.description.trim() ||
          !Number.isFinite(Number(item.quantity)) ||
          Number(item.quantity) <= 0 ||
          !Number.isFinite(Number(item.unit_price)) ||
          Number(item.unit_price) < 0
      )
    ) {
      alert("Please check all descriptions, quantities and prices.");
      return;
    }

    if (!aiInvoiceForm.client_id || !aiInvoiceForm.due_date) {
      alert("Please select a client and invoice due date.");
      return;
    }

    if (aiInvoiceForm.due_date < aiInvoiceForm.issue_date) {
      alert("Due date cannot be earlier than issue date.");
      return;
    }

    setAiSaving(true);

    try {
      await request("/api/invoices", {
        method: "POST",
        body: JSON.stringify({
          client_id: Number(aiInvoiceForm.client_id),
          issue_date: aiInvoiceForm.issue_date,
          due_date: aiInvoiceForm.due_date,
          items: aiItems.map((item) => ({
            description: item.description.trim(),
            quantity: Number(item.quantity),
            unit_price: Number(item.unit_price)
          }))
        })
      });

      setAiItems([]);
      setWorkDescription("");
      setAiError("");

      setAiInvoiceForm({
        client_id: "",
        issue_date: new Date().toISOString().slice(0, 10),
        due_date: ""
      });

      await loadData();
      setPage("Invoices");

    } catch (err) {
      alert(err.message);
    } finally {
      setAiSaving(false);
    }
  }
// Download invoice PDF
async function downloadInvoicePDF(invoice) {
  try {
    const response = await fetch(
      `${API}/api/invoices/${invoice.id}/pdf`
    );

    if (!response.ok) {
      throw new Error("Unable to download invoice PDF.");
    }

    const blob = await response.blob();
    const downloadUrl = window.URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = `${invoice.invoice_number}.pdf`;

    document.body.appendChild(link);
    link.click();

    document.body.removeChild(link);
    window.URL.revokeObjectURL(downloadUrl);

  } catch (err) {
    alert(err.message);
  }
}
async function sendInvoiceEmail(invoice) {
  try {
    const response = await fetch(
      `${API}/api/invoices/${invoice.id}/send`,
      {
        method: "POST"
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data.detail || "Unable to send invoice email."
      );
    }

    // Update the invoice status in the frontend
    setInvoices((previousInvoices) =>
      previousInvoices.map((item) =>
        item.id === invoice.id
          ? { ...item, status: data.status || "sent" }
          : item
      )
    );

    alert(`Invoice email sent successfully to ${data.recipient}!`);

  } catch (err) {
    alert(err.message);
  }
}
// Create a PayPal Sandbox order
async function createPayPalOrder(invoice) {
  const result = await request(
    `/api/invoices/${invoice.id}/paypal/create-order`,
    {
      method: "POST"
    }
  );

  const confirmed = window.confirm(
    `Invoice amount: ${money(Number(result.invoice_amount_inr))}\n` +
    `PayPal amount: $${result.amount_usd} USD\n` +
    `Conversion rate: ₹${result.exchange_rate_inr_per_usd} per USD\n\n` +
    `Continue to PayPal Sandbox checkout?`
  );

  if (!confirmed) {
    throw new Error("Payment cancelled.");
  }

  return result.order_id;
}

// Capture and verify the PayPal payment
async function capturePayPalPayment(invoice, orderId) {
  try {
    const result = await request(
      `/api/invoices/${invoice.id}/paypal/capture-order`,
      {
        method: "POST",
        body: JSON.stringify({
          order_id: orderId
        })
      }
    );

    await loadData();

    alert(
      `Payment successful!\nInvoice ${result.invoice_number} is now paid.`
    );

  } catch (err) {
    alert(`Payment verification failed: ${err.message}`);
    throw err;
  }
}
async function deleteInvoice(invoice) {
  const confirmDelete = window.confirm(
    `Are you sure you want to delete invoice ${invoice.invoice_number}?`
  );

  if (!confirmDelete) {
    return;
  }

  try {
    const response = await fetch(
      `${API}/api/invoices/${invoice.id}`,
      {
        method: "DELETE"
      }
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        data.detail || "Unable to delete invoice."
      );
    }

    setInvoices((previousInvoices) =>
      previousInvoices.filter(
        (item) => item.id !== invoice.id
      )
    );

    alert("Invoice deleted successfully!");

  } catch (err) {
    alert(err.message);
  }
}
  // Currency formatting
  const money = (amount) =>
    new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 2
    }).format(amount || 0);
// Demo-only paid status for Rahul Sharma's invoice

  // Get client name
  function clientName(id) {
    return (
      clients.find((client) => client.id === id)?.name ||
      "Unknown client"
    );
  }

  // AI invoice total
  const aiTotal = aiItems.reduce(
    (total, item) =>
      total +
      Number(item.quantity || 0) *
      Number(item.unit_price || 0),
    0
  );

  // Sidebar navigation
  const navItems = [
    { name: "Dashboard", icon: "▦" },
    { name: "Invoices", icon: "▤" },
    { name: "Clients", icon: "♙" },
    { name: "AI Invoice Generator", icon: "✧" },
    { name: "Payments", icon: "₹" }
  ];

  return (

    <div className="app-layout">

      {/* SIDEBAR */}
      <aside className="sidebar">

        <div className="brand">
          <div className="brand-icon">F</div>
          <div>
            <h2>FreelanceFlow</h2>
            <span>AI INVOICING</span>
          </div>
        </div>

        <div className="workspace-label">WORKSPACE</div>

        <nav>
          {navItems.map((item) => (
            <button
              key={item.name}
              className={`nav-item ${
                page === item.name ? "active" : ""
              }`}
              onClick={() => {
                setPage(item.name);
                setShowClientForm(false);
                setShowInvoiceForm(false);
              }}
            >
              <span className="nav-icon">{item.icon}</span>
              {item.name}

              {item.name === "AI Invoice Generator" && (
                <span className="new-tag">AI</span>
              )}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="profile-avatar">G</div>
          <div>
            <strong>My Workspace</strong>
            <span>Freelancer account</span>
          </div>
        </div>

      </aside>

      {/* MAIN CONTENT */}
      <main className="main-content">

        {/* TOPBAR */}
        <header className="topbar">
          <div>
            <span className="breadcrumb">Workspace / </span>
            <strong>{page}</strong>
          </div>

          <div className="topbar-right">
            <span className="connection-dot"></span>
            <span>System connected</span>
            <div className="top-avatar">G</div>
          </div>
        </header>

        <section className="page-content">

          {error && (
            <div className="error-banner">
              {error}
              <button onClick={loadData}>Retry</button>
            </div>
          )}

          {loading ? (
            <div className="loading">
              Loading your workspace...
            </div>
          ) : (
            <>

              {/* DASHBOARD */}
              {page === "Dashboard" && (
                <>

                  <div className="welcome-row">
                    <div>
                      <p className="eyebrow">OVERVIEW</p>
                      <h1>Welcome back!</h1>
                      <p className="subtitle">
                        Here's what's happening with your freelance business.
                      </p>
                    </div>

                    <button
                      className="primary-button"
                      onClick={() => {
                        setPage("Invoices");
                        setShowInvoiceForm(true);
                      }}
                    >
                      + Create invoice
                    </button>
                  </div>

                  <div className="stats-grid">

                    <StatCard
                      title="Total invoices"
                      value={dashboard?.total_invoices ?? 0}
                      note="All invoices created"
                      icon="▤"
                    />

                    <StatCard
                      title="Total revenue"
                      value={money(dashboard?.total_revenue)}
                      note="From paid invoices"
                      icon="₹"
                    />

                    <StatCard
                      title="Pending invoices"
                      value={dashboard?.pending_invoices ?? 0}
                      note="Awaiting payment"
                      icon="◷"
                    />

                    <StatCard
                      title="Overdue invoices"
                      value={dashboard?.overdue_invoices ?? 0}
                      note="Past their due date"
                      icon="!"
                    />

                  </div>

                  <div className="content-card">

                    <div className="section-heading">
                      <div>
                        <h2>Recent invoices</h2>
                        <p>Your latest billing activity</p>
                      </div>

                      <button
                        className="text-button"
                        onClick={() => setPage("Invoices")}
                      >
                        View all →
                      </button>
                    </div>

                    <InvoiceTable
                      invoices={invoices.slice(0, 5)}
                      clientName={clientName}
                      money={money}
                      onDownload={downloadInvoicePDF}
                      onSend={sendInvoiceEmail}
                      onDelete={deleteInvoice}
                      onCreatePayPalOrder={createPayPalOrder}
                      onCapturePayPalPayment={capturePayPalPayment}
                    />

                  </div>

                  <div className="bottom-grid">

                    <div className="content-card mini-card">
                      <h3>Outstanding amount</h3>
                      <div className="big-number">
                        {money(dashboard?.outstanding_amount)}
                      </div>
                      <p>Invoices still awaiting payment</p>
                    </div>

                    <div className="content-card mini-card">
                      <h3>Your clients</h3>
                      <div className="big-number">
                        {clients.length}
                      </div>
                      <p>Clients in your workspace</p>

                      <button
                        className="text-button"
                        onClick={() => setPage("Clients")}
                      >
                        Manage clients →
                      </button>
                    </div>

                  </div>

                </>
              )}

              {/* CLIENTS */}
              {page === "Clients" && (
                <>

                  <div className="welcome-row">
                    <div>
                      <p className="eyebrow">RELATIONSHIPS</p>
                      <h1>Clients</h1>
                      <p className="subtitle">
                        Manage the people and businesses you work with.
                      </p>
                    </div>

                    <button
                      className="primary-button"
                      onClick={() => setShowClientForm(!showClientForm)}
                    >
                      + Add client
                    </button>
                  </div>

                  {showClientForm && (
                    <form
                        className="content-card form-card"
                        onSubmit={editingClientId ? updateClient : addClient}

                    >
                      <h2>{editingClientId ? "Edit client details" : "Add a new client"}</h2>

                      <div className="form-grid">

                        <FormField label="Client name">
                          <input
                            required
                            value={clientForm.name}
                            onChange={(e) =>
                              setClientForm({
                                ...clientForm,
                                name: e.target.value
                              })
                            }
                            placeholder="Enter client name"
                          />
                        </FormField>

                        <FormField label="Email address">
                          <input
                            required
                            type="email"
                            value={clientForm.email}
                            onChange={(e) =>
                              setClientForm({
                                ...clientForm,
                                email: e.target.value
                              })
                            }
                            placeholder="client@example.com"
                          />
                        </FormField>

                        <FormField label="Company">
                          <input
                            value={clientForm.company}
                            onChange={(e) =>
                              setClientForm({
                                ...clientForm,
                                company: e.target.value
                              })
                            }
                            placeholder="Company name"
                          />
                        </FormField>

                        <FormField label="Phone">
                          <input
                            value={clientForm.phone}
                            onChange={(e) =>
                              setClientForm({
                                ...clientForm,
                                phone: e.target.value
                              })
                            }
                            placeholder="Phone number"
                          />
                        </FormField>

                      </div>

                      <div className="form-actions">
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => {
  setShowClientForm(false);
  setEditingClientId(null);
  setClientForm({
    name: "",
    email: "",
    company: "",
    phone: ""
  });
} }
                        >
                          Cancel
                        </button>

                        <button className="primary-button">
                            {editingClientId ? "Save Changes" : "Save client"}

                        </button>
                      </div>

                    </form>
                  )}

                  <div className="content-card">

                    <div className="section-heading">
                      <div>
                        <h2>All clients</h2>
                        <p>{clients.length} clients registered</p>
                      </div>
                    </div>

                    <div className="client-list">

                      {clients.map((client) => (
                        <div
                          className="client-row"
                          key={client.id}
                        >
                          <div className="client-avatar">
                            {client.name.charAt(0).toUpperCase()}
                          </div>

                          <div className="client-info">
                            <strong>{client.name}</strong>
                            <span>{client.email}</span>
                          </div>

                          <span className="company-name">
                            {client.company || "Individual"}
                            <div className="client-actions">
  <button
    type="button"
    className="secondary-button"
    onClick={() => startEditClient(client)}
  >
    Edit
  </button>

  <button
    type="button"
    className="secondary-button"
    onClick={() => deleteClient(client)}
  >
    Delete
  </button>
</div>
                          </span>
                        </div>
                      ))}

                      {clients.length === 0 && (
                        <div className="empty-state">
                          No clients yet. Add your first client.
                        </div>
                      )}

                    </div>
                  </div>

                </>
              )}

              {/* INVOICES */}
              {page === "Invoices" && (
                <>

                  <div className="welcome-row">
                    <div>
                      <p className="eyebrow">BILLING</p>
                      <h1>Invoices</h1>
                      <p className="subtitle">
                        Create and track your freelance invoices.
                      </p>
                    </div>

                    <button
                      className="primary-button"
                      onClick={() => setShowInvoiceForm(!showInvoiceForm)}
                    >
                      + Create invoice
                    </button>
                  </div>

                  {showInvoiceForm && (
                    <form
                      className="content-card form-card"
                      onSubmit={addInvoice}
                    >
                      <h2>Create a new invoice</h2>

                      {clients.length === 0 ? (
                        <p>Add a client before creating an invoice.</p>
                      ) : (
                        <>

                          <div className="form-grid">

                            <FormField label="Select client">
                              <select
                                required
                                value={invoiceForm.client_id}
                                onChange={(e) =>
                                  setInvoiceForm({
                                    ...invoiceForm,
                                    client_id: e.target.value
                                  })
                                }
                              >
                                <option value="">Choose a client</option>

                                {clients.map((client) => (
                                  <option
                                    key={client.id}
                                    value={client.id}
                                  >
                                    {client.name}
                                  </option>
                                ))}
                              </select>
                            </FormField>

                            <FormField label="Issue date">
                              <input
                                type="date"
                                required
                                value={invoiceForm.issue_date}
                                onChange={(e) =>
                                  setInvoiceForm({
                                    ...invoiceForm,
                                    issue_date: e.target.value
                                  })
                                }
                              />
                            </FormField>

                            <FormField label="Due date">
                              <input
                                type="date"
                                required
                                min={invoiceForm.issue_date}
                                value={invoiceForm.due_date}
                                onChange={(e) =>
                                  setInvoiceForm({
                                    ...invoiceForm,
                                    due_date: e.target.value
                                  })
                                }
                              />
                            </FormField>
                                {/* MULTIPLE INVOICE ITEMS */}

{invoiceForm.items.map((item, index) => (
  <div className="ai-item" key={index}>

    <h3>Invoice Item {index + 1}</h3>

    <FormField label="Service description">
      <input
        required
        value={item.description}
        onChange={(e) =>
          updateManualItem(
            index,
            "description",
            e.target.value
          )
        }
        placeholder="e.g. Website UI design"
      />
    </FormField>

    <div className="form-grid">

      <FormField label="Quantity">
        <input
          type="number"
          min="0.01"
          step="0.01"
          required
          value={item.quantity}
          onChange={(e) =>
            updateManualItem(
              index,
              "quantity",
              e.target.value
            )
          }
        />
      </FormField>

      <FormField label="Price per unit (₹)">
        <input
          type="number"
          min="0"
          step="0.01"
          required
          value={item.unit_price}
          onChange={(e) =>
            updateManualItem(
              index,
              "unit_price",
              e.target.value
            )
          }
          placeholder="Enter agreed price"
        />
      </FormField>

    </div>

    {invoiceForm.items.length > 1 && (
      <button
        type="button"
        className="secondary-button"
        onClick={() => removeManualItem(index)}
      >
        Remove item
      </button>
    )}

  </div>
))}

<button
  type="button"
  className="secondary-button"
  onClick={addManualItem}
>
  + Add Item
</button>
                          </div>

                          <div className="invoice-total-preview">
                            Estimated total: {money(manualTotal)}
                          </div>

                          <div className="form-actions">

                            <button
                              type="button"
                              className="secondary-button"
                              onClick={() => setShowInvoiceForm(false)}
                            >
                              Cancel
                            </button>

                            <button className="primary-button">
                              Create invoice
                            </button>

                          </div>

                        </>
                      )}

                    </form>
                  )}

                  <div className="content-card">

                    <div className="section-heading">
                      <div>
                        <h2>All invoices</h2>
                        <p>
                          {invoices.length} invoices in your workspace
                        </p>
                      </div>
                    </div>

                    <InvoiceTable
                      invoices={invoices}
                      clientName={clientName}
                      money={money}
                      onDownload={downloadInvoicePDF}
                      onSend={sendInvoiceEmail}
                      onDelete={deleteInvoice}
                      onCreatePayPalOrder={createPayPalOrder}
                      onCapturePayPalPayment={capturePayPalPayment}
                    />

                  </div>

                </>
              )}

              {/* AI INVOICE GENERATOR */}
              {page === "AI Invoice Generator" && (
                <>

                  <div className="welcome-row">
                    <div>
                      <p className="eyebrow">INTELLIGENT BILLING</p>
                      <h1>AI Invoice Generator</h1>
                      <p className="subtitle">
                        Describe your completed work and let Gemini
                        prepare your invoice.
                      </p>
                    </div>
                  </div>

                  {/* WORK DESCRIPTION */}
                  <form
                    className="content-card form-card"
                    onSubmit={generateAIInvoice}
                  >

                    <h2>Describe your completed work</h2>

                    <p className="subtitle">
                      Include the services you provided, tasks completed
                      and quantities wherever known.
                    </p>

                    <FormField label="Work description">

                      <textarea
                        required
                        minLength={10}
                        maxLength={5000}
                        rows={5}
                        value={workDescription}
                        onChange={(e) =>
                          setWorkDescription(e.target.value)
                        }
                        placeholder="Example: Designed a business website homepage, developed three responsive pages and fixed mobile layout issues."
                      />

                    </FormField>

                    {aiError && (
                      <div className="error-banner">
                        {aiError}
                      </div>
                    )}

                    <div className="form-actions">

                      <button
                        type="submit"
                        className="primary-button"
                        disabled={
                          aiLoading ||
                          workDescription.trim().length < 10
                        }
                      >
                        {aiLoading
                          ? "Generating..."
                          : "✧ Generate invoice with AI"}
                      </button>

                    </div>

                  </form>

                  {/* GENERATED ITEMS */}
                  {aiItems.length > 0 && (
                    <form
                      className="content-card form-card"
                      onSubmit={createAIInvoice}
                    >

                      <h2>Review your AI-generated items</h2>

                      <p className="subtitle">
                        Check every description and quantity.
                        Enter the agreed price yourself before
                        creating the invoice.
                      </p>

                      {aiItems.map((item) => (
                        <div className="ai-item" key={item.id}>

                          <FormField label="Service description">

                            <input
                              required
                              value={item.description}
                              onChange={(e) =>
                                updateAIItem(
                                  item.id,
                                  "description",
                                  e.target.value
                                )
                              }
                            />

                          </FormField>

                          <div className="form-grid">

                            <FormField label="Quantity">

                              <input
                                type="number"
                                min="0.01"
                                step="0.01"
                                required
                                value={item.quantity}
                                onChange={(e) =>
                                  updateAIItem(
                                    item.id,
                                    "quantity",
                                    e.target.value
                                  )
                                }
                              />

                            </FormField>

                            <FormField label="Price per unit (₹)">

                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                required
                                value={item.unit_price}
                                onChange={(e) =>
                                  updateAIItem(
                                    item.id,
                                    "unit_price",
                                    e.target.value
                                  )
                                }
                              />

                            </FormField>

                          </div>

                          <p className="ai-item-total">
                            Item total:{" "}
                            {money(
                              Number(item.quantity) *
                              Number(item.unit_price)
                            )}
                          </p>

                        </div>
                      ))}

                      {/* TOTAL */}
                      <div className="invoice-total-preview">
                        Estimated invoice total: {money(aiTotal)}
                      </div>

                      {/* CLIENT AND DATES */}
                      <div className="form-grid">

                        <FormField label="Select client">

                          <select
                            required
                            value={aiInvoiceForm.client_id}
                            onChange={(e) =>
                              setAiInvoiceForm({
                                ...aiInvoiceForm,
                                client_id: e.target.value
                              })
                            }
                          >

                            <option value="">Choose a client</option>

                            {clients.map((client) => (
                              <option
                                key={client.id}
                                value={client.id}
                              >
                                 {client.name}
                              </option>
                            ))}

                          </select>

                        </FormField>

                        <FormField label="Issue date">

                          <input
                            type="date"
                            required
                            value={aiInvoiceForm.issue_date}
                            onChange={(e) =>
                              setAiInvoiceForm({
                                ...aiInvoiceForm,
                                issue_date: e.target.value
                              })
                            }
                          />

                        </FormField>

                        <FormField label="Due date">

                          <input
                            type="date"
                            required
                            min={aiInvoiceForm.issue_date}
                            value={aiInvoiceForm.due_date}
                            onChange={(e) =>
                              setAiInvoiceForm({
                                ...aiInvoiceForm,
                                due_date: e.target.value
                              })
                            }
                          />

                        </FormField>

                      </div>

                      {clients.length === 0 && (
                        <div className="error-banner">
                          Please add a client before creating an invoice.
                        </div>
                      )}

                      {/* ACTIONS */}
                      <div className="form-actions">

                        <button
                          type="button"
                          className="secondary-button"
                          disabled={aiSaving}
                          onClick={() => setAiItems([])}
                        >
                          Discard draft
                        </button>

                        <button
                          type="submit"
                          className="primary-button"
                          disabled={
                            aiSaving ||
                            clients.length === 0
                          }
                        >
                          {aiSaving
                            ? "Saving invoice..."
                            : "Create invoice"}
                        </button>

                      </div>

                    </form>
                  )}

                </>
              )}
               {/* PAYMENTS */}
{page === "Payments" && (
  <>
    <div className="welcome-row">
      <div>
        <p className="eyebrow">TRANSACTIONS</p>
        <h1>Payments</h1>
        <p className="subtitle">
          View your completed payments.
        </p>
      </div>
    </div>

    <div className="content-card">
      <div className="section-heading">
        <div>
          <h2>Recent Payments</h2>
          <p>Payment transaction details</p>
        </div>
      </div>

      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>CLIENT</th>
              <th>INVOICE</th>
              <th>DATE</th>
              <th>PAYMENT METHOD</th>
              <th>AMOUNT</th>
              <th>STATUS</th>
            </tr>
          </thead>

          <tbody>
            <tr>
              <td>Rahul Sharma</td>
              <td>FF-DA5C349E</td>
              <td>2026-10-30</td>
              <td>PayPal</td>
              <td className="amount-cell">₹11,000.00</td>
              <td>
                <span className="status-pill paid">
                  Paid
                </span>
                <div className="feature-label">
                  Demo Transaction
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </>
)}

            </>
          )}

        </section>

      </main>

    </div>

  );
}

// STAT CARD
function StatCard({ title, value, note, icon }) {
  return (
    <div className="stat-card">

      <div className="stat-top">
        <span>{title}</span>
        <span className="stat-icon">{icon}</span>
      </div>

      <div className="stat-value">{value}</div>

      <p>{note}</p>

    </div>
  );
}

// FORM FIELD
function FormField({ label, children }) {
  return (
    <label className="form-field">

      <span>{label}</span>

      {children}

    </label>
  );
}

// INVOICE TABLE
function InvoiceTable({   invoices,
  clientName,
  money,
  onDownload,
  onSend,
  onDelete,
  onCreatePayPalOrder,
  onCapturePayPalPayment
}) {

  if (invoices.length === 0) {
    return (
      <div className="empty-state">
        No invoices found. Create your first invoice.
      </div>
    );
  }

  return (
    <div className="table-scroll">

      <table>

        <thead>
          <tr>
            <th>INVOICE</th>
            <th>CLIENT</th>
            <th>ISSUE DATE</th>
            <th>DUE DATE</th>
            <th>AMOUNT</th>
            <th>STATUS</th>
            <th>ACTION</th>
          </tr>
        </thead>

        <tbody>

          {invoices.map((invoice) => {
            return(
            <tr key={invoice.id}>

              <td className="invoice-number">
                {invoice.invoice_number}
              </td>

              <td>{clientName(invoice.client_id)}</td>

              <td>{invoice.issue_date}</td>

              <td>{invoice.due_date}</td>

              <td className="amount-cell">
                {money(invoice.total_amount)}
              </td>

              <td>
                <span className={`status-pill ${invoice.status}`}>
                  {invoice.status}
                </span>
              </td>
              <td>
             <button
              type="button"
               className="secondary-button"
               onClick={() => onDownload(invoice)}
                 >
               ↓ Download PDF
             </button>
{invoice.status === "paid" ? (
  <span className="payment-completed-text">
    Payment Completed
  </span>
) : (
  <button
    type="button"
    className="primary-button"
    onClick={() => onSend(invoice)}
  >
    ✉ Send Email
  </button>
)}
  <button
  type="button"
  className="secondary-button"
  onClick={() => onDelete(invoice)}
  disabled={invoice.status === "paid"}
  title={
    invoice.status === "paid"
      ? "Paid invoices cannot be deleted"
      : "Delete invoice"
  }
>
  🗑 {invoice.status === "paid" ? "Protected" : "Delete"}
</button>


</td>
            </tr>
          );
})}

        </tbody>

      </table>

    </div>
    
  );
}

export default App;

function ClientPaymentPage({ token }) {
  const [invoice, setInvoice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [paymentInfo, setPaymentInfo] = useState(null);
  const [paid, setPaid] = useState(false);

  useEffect(() => {
    async function loadInvoice() {
      try {
        const response = await fetch(
          `${API}/api/public/invoices/${token}`
        );

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.detail || "Unable to load invoice");
        }

        setInvoice(data);
        setPaid(data.status === "paid");
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }

    loadInvoice();
  }, [token]);

  async function createOrder() {
    const response = await fetch(
      `${API}/api/public/invoices/${token}/paypal/create-order`,
      { method: "POST" }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.detail || "Could not create PayPal order");
    }

    setPaymentInfo(data);
    return data.order_id;
  }

  async function capturePayment(orderID) {
    const response = await fetch(
      `${API}/api/public/invoices/${token}/paypal/capture-order`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          order_id: orderID
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.detail || "Payment verification failed");
    }

    setPaid(true);
    setInvoice((previous) => ({
      ...previous,
      status: "paid"
    }));
  }

  if (loading) {
    return <div className="client-payment-page">Loading invoice...</div>;
  }

  if (error) {
    return <div className="client-payment-page">Error: {error}</div>;
  }

  if (!invoice) {
    return <div className="client-payment-page">Invoice not found.</div>;
  }

  return (
    <div className="client-payment-page">
      <div className="client-payment-card">
        <h1>FreelanceFlow AI</h1>
        <h2>Invoice {invoice.invoice_number}</h2>

        <p>Bill To: {invoice.client.name}</p>

        {invoice.client.company && (
          <p>Company: {invoice.client.company}</p>
        )}

        <p>Issue Date: {invoice.issue_date}</p>
        <p>Due Date: {invoice.due_date}</p>

        <hr />

        <h3>Invoice Items</h3>

        <table>
          <thead>
            <tr>
              <th>Description</th>
              <th>Quantity</th>
              <th>Amount</th>
            </tr>
          </thead>

          <tbody>
            {invoice.items.map((item, index) => (
              <tr key={index}>
                <td>{item.description}</td>
                <td>{item.quantity}</td>
                <td>₹{Number(item.amount).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h2>
          Total: ₹{Number(invoice.total_amount).toFixed(2)}
        </h2>

        {paid ? (
          <h2>Payment Successful! This invoice is paid.</h2>
        ) : (
          <>
            <h3>Pay securely with PayPal</h3>

            <PayPalButtons
              style={{
                layout: "vertical",
                shape: "rect",
                label: "pay"
              }}
              createOrder={createOrder}
              onApprove={async (data) => {
                try {
                  await capturePayment(data.orderID);
                } catch (err) {
                  alert(err.message);
                }
              }}
              onError={(err) => {
                console.error(err);
                alert("PayPal payment failed. Please try again.");
              }}
            />

            {paymentInfo && (
              <p>
                PayPal amount: ${paymentInfo.amount_usd} USD
                <br />
                Exchange rate: ₹{paymentInfo.exchange_rate_inr_per_usd}
                per USD
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
