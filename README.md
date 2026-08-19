# Organizador da barra lateral do Google Chat

Extensão de Chrome que agrupa os espaços do Google Chat em **seções por prefixo do nome**, em um clique. Reproduz na tela os quatro passos que hoje se faz na mão (ordenar → criar seções → arrastar → voltar para "mais recentes").

Feita para a migração da L2, mas **nada da L2 está no código**: os prefixos vêm de uma configuração de regras, importável e exportável por JSON. Com outra configuração (`#eng`, `#vendas`), funciona igual.

---

## O que ela faz

1. **Ordena a lista alfabeticamente** (andaime — junta os iguais para o arraste ser sequencial)
2. **Cria só as seções que a sua lista precisa** (idempotente: não duplica seção existente)
3. **Arrasta cada espaço** para a seção certa
4. **Volta para "mais recentes"** (as seções ficam; dentro de cada uma, o recente sobe)

O que ela **não** faz: renomear espaço, sair de espaço, mudar membro, postar, alterar notificação. Só mexe em seção e posição, e só na **sua** conta.

---

## Instalação (a partir do ZIP — 1 minuto)

Ainda não está na Chrome Web Store; instala-se como extensão descompactada, a partir do ZIP publicado nos **Releases**.

1. Baixe o arquivo **`organizador-google-chat.zip`** da [página de Releases](../../releases/latest)
2. **Descompacte** o ZIP numa pasta que vá ficar no computador (ex.: `Documentos/extensao-chat`). O Chrome carrega a pasta descompactada, não o ZIP — se apagar a pasta, a extensão para de funcionar
3. Abra o Chrome em **`chrome://extensions`**
4. **Ligue o "Modo do desenvolvedor"** — a chave fica no **canto superior direito** da página. Sem ela, o botão "Carregar sem compactação" nem aparece
5. Clique em **Carregar sem compactação** (*Load unpacked*) e selecione a **pasta descompactada** (a que contém o `manifest.json`)
6. A extensão aparece na lista, com o ícone do Lincaz. Fixe na barra (ícone de peça de quebra-cabeça → alfinete)

> **Perfil gerenciado pela empresa:** se o topo da página disser "Seu perfil é gerenciado por l2code.com.br", a política do Google Workspace pode bloquear extensões descompactadas. Se o "Carregar sem compactação" estiver desabilitado, fale com o admin — a alternativa é publicar na Chrome Web Store (privada da organização).

> Para atualizar quando sair versão nova: baixe o ZIP novo, descompacte por cima da mesma pasta e clique no ↻ do card em `chrome://extensions`.

---

## Como usar

1. Abra o **Google Chat** em `https://chat.google.com` e deixe logado, com a lista de espaços visível
2. Clique no ícone da extensão para abrir o painel
3. **Preset L2** carrega a configuração da L2. (Ou **Importar JSON** para usar outra.)
4. Clique em **Ler espaços da aba** — a pré-visualização mostra cada espaço e a seção em que vai cair
5. Nos espaços **sem prefixo** (convidados/reuniões), escolha a seção ou deixe em "ignorar"
6. Clique em **Aplicar na aba do Chat** e acompanhe o painel de progresso na página

Rodar duas vezes é seguro: não cria seção duplicada nem move o que já está no lugar.

---

## A configuração

A tabela nome→seção é uma **lista ordenada de regras**. Vence a **primeira que casar** (por isso `[OLD]` fica no topo: `[OLD][Projeto]` vai para 📦 OLD, não para 🚀 Projeto).

```json
{
  "regras": [
    { "casa": "contem", "texto": "[OLD]",     "secao": "📦 OLD" },
    { "casa": "comeca", "texto": "[L2]",      "secao": "🏢 L2" },
    { "casa": "comeca", "texto": "[Gestão]",  "secao": "🎯 Gestão" }
  ],
  "semCorrespondencia": "perguntar"
}
```

- **`casa`**: `comeca` (o nome começa com o texto) ou `contem` (aparece em qualquer posição)
- **`semCorrespondencia`**: `perguntar` (mostra na pré-visualização e você decide), `ignorar` (deixa quieto) ou o **nome de uma seção coringa** (joga todos os sem-prefixo nela)

A configuração da L2 está pronta em [`preset-l2.json`](preset-l2.json) — é o que o botão **Preset L2** carrega. Para distribuir para a equipe: cada um importa esse JSON, ou você edita, exporta e manda o arquivo.

### Espaços de convidado (a parte que exige decisão)

Regra visual, não falha: **tem colchete no começo, é nosso; não tem, é de fora** (ou é reunião do Meet, que também não deve ser mexida). Como o nome do espaço do cliente não diz de qual cliente é, esses caem em "Perguntar" e você escolhe a seção na pré-visualização (ex.: `🚪 {Cliente} convida L2`) — nunca chuta.

---

## Limites conhecidos

- **O DOM do Google Chat é ofuscado e muda sem aviso.** A extensão se ancora em `aria-label`, `role` e texto visível, nunca em nome de classe. Se o Chat mudar o layout e algo não for encontrado, ela **para e avisa no painel** em vez de arrastar para o lugar errado em silêncio. Os itens com ✗ podem precisar de arraste manual — nada é destrutivo.
- **O arraste é a parte frágil** (lista virtualizada). A extensão rola e reconfere a cada item; ainda assim, em listas grandes algum arraste pode falhar e aparecer no relatório final.
- **Só afeta quem rodou.** Seção é preferência local da conta — não dá para aplicar em outra pessoa; cada um roda na sua.
- **Suporte:** `chat.google.com` (recomendado) e o Chat embutido no Gmail (`mail.google.com/chat`).

---

## Estrutura do código

```
manifest.json        Manifest V3, permissões e onde a extensão roda
preset-l2.json       Configuração da L2 (também embutida para o botão Preset L2)
src/config.js        Regras + lógica pura "nome → seção" (sem DOM). Usada nos dois lados
src/content.js       O motor: automatiza os 4 passos no DOM do Chat. Painel de progresso
src/popup.html/.css/.js   Painel: preset, editor de regras, import/export, pré-visualização
```
