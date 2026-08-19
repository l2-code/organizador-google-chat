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

## Instalação

Dados úteis para qualquer caminho:

- **ID da extensão:** `ekfkifodmlpcikkemndbeabfhamneipo`
- **URL de atualização:** `https://raw.githubusercontent.com/l2-code/organizador-google-chat/main/updates.xml`
- **Instalador (`.crx`)** e **`.zip`** ficam na [página de Releases](../../releases/latest).

### Recomendado — Google Admin Console (toda a equipe de uma vez)

Como os perfis da L2 são gerenciados por `l2code.com.br`, o admin instala para todo mundo, sem ninguém mexer:

1. **admin.google.com** → **Dispositivos** → **Chrome** → **Apps e extensões** → **Usuários e navegadores**
2. Selecione a unidade organizacional (ou a organização toda)
3. Botão **＋** → **Adicionar app ou extensão do Chrome por ID**
4. **ID:** `ekfkifodmlpcikkemndbeabfhamneipo` — **De um URL personalizado:** a URL de atualização acima
5. **Política de instalação:** **Instalação forçada**
6. Salvar. Instala sozinha na próxima sincronização do Chrome e **atualiza sozinha** a cada nova versão.

> O `.crx` é o instalador usado por este fluxo. **Arrastar o `.crx` manualmente para `chrome://extensions` não funciona** — o Chrome bloqueia instalação de `.crx` fora da Web Store. Para instalação individual, use o caminho de descompactada abaixo.

### Piloto / uso individual — extensão descompactada (a partir do ZIP)

1. Baixe **`organizador-google-chat.zip`** da [página de Releases](../../releases/latest)
2. **Descompacte** numa pasta fixa (o Chrome carrega a pasta, não o ZIP)
3. `chrome://extensions` → ligue o **Modo do desenvolvedor** (canto superior direito)
4. **Carregar sem compactação** → selecione a pasta descompactada (a que tem o `manifest.json`)
5. Fixe o ícone do Lincaz na barra

> **Perfil gerenciado:** se "Carregar sem compactação" estiver desabilitado, é a política do Workspace — use o caminho do Admin Console acima.
>
> Atualizar: baixe o ZIP novo, descompacte por cima da mesma pasta e clique no ↻ do card. (Ao trocar o código, **↻ no card + F5 na aba do Chat**.)

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
