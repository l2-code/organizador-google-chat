/* popup.js — a interface de configuração e o botão que dispara a automação. */
(function () {
  "use strict";
  const L2 = window.L2Chat;

  let config = null;                 // config ativa em edição
  let ultimoPreview = null;          // { plano, decisoes }
  const $ = (s) => document.querySelector(s);

  // ---------- estado / persistência ----------
  async function iniciar() {
    config = await L2.carregarConfig();
    normalizar();
    render();
  }
  function normalizar() {
    if (!config.regras) config.regras = [];
    if (!config.semCorrespondencia) config.semCorrespondencia = "perguntar";
  }
  function persistir() { L2.salvarConfig(config); }

  // ---------- render das regras ----------
  function render() {
    const box = $("#regras");
    box.innerHTML = "";
    config.regras.forEach((r, i) => box.appendChild(linhaRegra(r, i)));
    $("#semCorrespondencia").value =
      (config.semCorrespondencia === "ignorar" || config.semCorrespondencia === "perguntar")
        ? config.semCorrespondencia : "perguntar";
  }

  function linhaRegra(r, i) {
    const el = document.createElement("div");
    el.className = "regra";

    const ordem = document.createElement("span");
    ordem.className = "ordem"; ordem.textContent = i + 1;

    const casa = document.createElement("select");
    casa.innerHTML = '<option value="comeca">começa</option><option value="contem">contém</option>';
    casa.value = r.casa || "comeca";
    casa.onchange = () => { r.casa = casa.value; persistir(); };

    const texto = document.createElement("input");
    texto.value = r.texto || ""; texto.placeholder = "[Projeto]";
    texto.oninput = () => { r.texto = texto.value; persistir(); };

    const secao = document.createElement("input");
    secao.value = r.secao || ""; secao.placeholder = "🚀 Projeto";
    secao.oninput = () => { r.secao = secao.value; persistir(); };

    const acoes = document.createElement("div");
    acoes.className = "acoes";
    acoes.appendChild(botao("↑", "Subir", () => mover(i, -1)));
    acoes.appendChild(botao("↓", "Descer", () => mover(i, +1)));
    acoes.appendChild(botao("✕", "Remover", () => { config.regras.splice(i, 1); persistir(); render(); }));

    el.append(ordem, casa, texto, secao, acoes);
    return el;
  }
  function botao(txt, title, fn) {
    const b = document.createElement("button"); b.textContent = txt; b.title = title; b.onclick = fn; return b;
  }
  function mover(i, d) {
    const j = i + d;
    if (j < 0 || j >= config.regras.length) return;
    const tmp = config.regras[i]; config.regras[i] = config.regras[j]; config.regras[j] = tmp;
    persistir(); render();
  }

  // ---------- pré-visualização ----------
  async function abaChat() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const t = tabs[0];
    if (!t) return null;
    const ok = /^https:\/\/chat\.google\.com\//.test(t.url || "") ||
               /^https:\/\/mail\.google\.com\/chat\//.test(t.url || "");
    return ok ? t : null;
  }

  function enviar(tabId, msg) {
    return new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, msg, (resp) => {
        if (chrome.runtime.lastError) resolve({ ok: false, erro: chrome.runtime.lastError.message });
        else resolve(resp || { ok: false, erro: "Sem resposta." });
      });
    });
  }

  async function preview() {
    setStatus("Lendo espaços…");
    const tab = await abaChat();
    if (!tab) return setStatus("Abra o Google Chat (chat.google.com) na aba ativa.", "erro");
    const resp = await enviar(tab.id, { tipo: "ler-espacos" });
    if (!resp.ok) return setStatus("Não consegui ler a aba. Recarregue o Chat e tente de novo. (" + resp.erro + ")", "erro");
    const nomes = resp.espacos || [];
    if (!nomes.length) return setStatus("Nenhum espaço lido. A lista de espaços está visível?", "erro");

    const plano = L2.planejar(nomes, config);
    ultimoPreview = { plano, decisoes: [] };
    renderPreview(plano);
    $("#btnAplicar").disabled = false;
    setStatus(nomes.length + " espaços lidos.", "ok");
  }

  function opcoesSecao() {
    // seções vindas das regras + destinos já escolhidos
    const set = new Set(config.regras.map((r) => r.secao).filter(Boolean));
    return Array.from(set);
  }

  function renderPreview(plano) {
    const box = $("#preview");
    box.className = "preview";
    box.innerHTML = "";

    const grupos = [
      { chave: "regra", rotulo: "Vão para uma seção" },
      { chave: "coringa", rotulo: "Seção coringa" },
      { chave: "perguntar", rotulo: "Sem prefixo — você decide" },
      { chave: "ignorar", rotulo: "Ignorados" }
    ];

    for (const g of grupos) {
      const itens = plano.filter((p) => p.motivo === g.chave);
      if (!itens.length) continue;
      const h = document.createElement("div");
      h.className = "pv-grupo"; h.textContent = g.rotulo + " (" + itens.length + ")";
      box.appendChild(h);
      itens.forEach((p) => box.appendChild(linhaPreview(p)));
    }
  }

  function linhaPreview(p) {
    const el = document.createElement("div");
    el.className = "pv-linha";
    const nome = document.createElement("div");
    nome.className = "pv-nome"; nome.textContent = p.nome; nome.title = p.nome;
    el.appendChild(nome);

    if (p.motivo === "perguntar") {
      // deixa a pessoa escolher a seção (ou ignorar) para este espaço
      const sel = document.createElement("select");
      const opt0 = new Option("— ignorar —", "");
      sel.appendChild(opt0);
      for (const s of opcoesSecao()) sel.appendChild(new Option(s, s));
      const optNova = new Option("+ nova seção…", "__nova__");
      sel.appendChild(optNova);
      sel.onchange = () => {
        let val = sel.value;
        if (val === "__nova__") {
          val = prompt("Nome da nova seção (pode incluir emoji):", "🚪 Convidam a L2") || "";
          if (val) { sel.appendChild(new Option(val, val)); sel.value = val; }
          else { sel.value = ""; val = ""; }
        }
        registrarDecisao(p.nome, val || null);
      };
      el.appendChild(sel);
    } else {
      const dest = document.createElement("div");
      dest.className = "pv-dest " + (p.motivo === "ignorar" ? "ignorar" : "");
      dest.textContent = p.secao || "ignorar";
      el.appendChild(dest);
    }
    return el;
  }

  function registrarDecisao(nome, secao) {
    const d = ultimoPreview.decisoes;
    const i = d.findIndex((x) => x.nome === nome);
    if (i >= 0) d[i].secao = secao; else d.push({ nome, secao });
  }

  // ---------- aplicar ----------
  async function aplicar() {
    const tab = await abaChat();
    if (!tab) return setStatus("Abra o Google Chat na aba ativa.", "erro");
    if (!ultimoPreview) return setStatus('Clique em "Ler espaços da aba" antes.', "erro");
    setStatus("Aplicando… acompanhe o painel na página do Chat.");
    $("#btnAplicar").disabled = true;
    const resp = await enviar(tab.id, {
      tipo: "aplicar",
      config: config,
      decisoes: ultimoPreview.decisoes
    });
    $("#btnAplicar").disabled = false;
    if (!resp.ok) return setStatus("Erro: " + resp.erro, "erro");
    const r = resp.resultado || {};
    setStatus(`Pronto. Movidos ${r.movidos || 0} · Pulados ${r.pulados || 0} · Falhas ${r.falhas || 0}.`,
      r.falhas ? "erro" : "ok");
  }

  // ---------- import / export ----------
  function exportar() {
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "config-barra-lateral-chat.json";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus("Configuração exportada.", "ok");
  }
  function importar(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const obj = JSON.parse(reader.result);
        const v = L2.validarConfig(obj);
        if (!v.ok) return setStatus("JSON inválido: " + v.erro, "erro");
        config = v.config; normalizar(); persistir(); render();
        $("#preview").className = "preview vazio";
        $("#preview").textContent = 'Configuração importada. Clique em "Ler espaços da aba".';
        $("#btnAplicar").disabled = true; ultimoPreview = null;
        setStatus("Configuração importada.", "ok");
      } catch (e) { setStatus("Arquivo não é um JSON válido.", "erro"); }
    };
    reader.readAsText(file);
  }

  function setStatus(msg, tipo) {
    const s = $("#status"); s.textContent = msg; s.className = "status" + (tipo ? " " + tipo : "");
  }

  // ---------- eventos ----------
  $("#btnPreset").onclick = () => {
    config = JSON.parse(JSON.stringify(L2.PRESET_L2)); persistir(); render();
    setStatus("Preset L2 carregado.", "ok");
  };
  $("#btnAddRegra").onclick = () => {
    config.regras.push({ casa: "comeca", texto: "", secao: "" }); persistir(); render();
  };
  $("#semCorrespondencia").onchange = (e) => { config.semCorrespondencia = e.target.value; persistir(); };
  $("#btnPreview").onclick = preview;
  $("#btnAplicar").onclick = aplicar;
  $("#btnExportar").onclick = exportar;
  $("#btnImportar").onclick = () => $("#arquivo").click();
  $("#arquivo").onchange = (e) => { if (e.target.files[0]) importar(e.target.files[0]); e.target.value = ""; };

  iniciar();
})();
