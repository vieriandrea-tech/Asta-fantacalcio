# Asta Fantacalcio

Sito per l'asta live del fantacalcio: 5 tasti di rilancio (+1, +2, +3, +5, +10), un campo per un rilancio libero, un tempo configurabile tra un rilancio e l'altro, e sincronizzazione in tempo reale tra tutti i partecipanti (nessun account richiesto).

Funziona su qualunque telefono, tablet o computer con un browser: basta aprire il link.

## Come funziona

- Chi arriva per primo (o chiunque, non c'è un "admin") scrive il nome del giocatore all'asta, il prezzo di partenza e i secondi tra un rilancio e l'altro, poi preme **Avvia l'asta**.
- Da quel momento tutti vedono la stessa offerta in tempo reale. Ogni rilancio (con i tasti +1/+2/+3/+5/+10, o scrivendo un numero libero) fa ripartire il conto alla rovescia.
- Quando il conto alla rovescia arriva a zero senza nuovi rilanci, il giocatore è **aggiudicato automaticamente** a chi ha fatto l'ultimo rilancio, e appare il pulsante **Prossima chiamata** per passare al giocatore successivo.
- C'è anche un pulsante "Annulla questa chiamata" per chi sbaglia ad avviare un'asta per errore.

Ogni persona sceglie il proprio nome al primo accesso (resta salvato sul suo dispositivo); non serve nessun account.

**Nota:** lo stato dell'asta vive nella memoria del server mentre è acceso. Se il server si riavvia (es. l'hosting gratuito "si addormenta" per inattività), l'asta in corso si azzera — per questo conviene aprire il sito qualche minuto prima di iniziare, così il server è già sveglio.

## 1. Provarlo in locale (facoltativo)

Se hai Node.js installato sul tuo computer:

```
npm install
npm start
```

poi apri `http://localhost:3000`. Da un altro dispositivo sulla stessa rete Wi-Fi puoi aprire `http://<indirizzo-IP-del-computer>:3000`.

## 2. Pubblicarlo online (per giocare anche da remoto)

Per farlo raggiungere da amici che non sono nella stessa stanza serve pubblicarlo su un servizio che lo tenga acceso su internet. Render.com legge il codice da un repository GitHub, quindi servono due passaggi: prima carichi i file su GitHub (senza bisogno di Git a riga di comando, si fa dal browser), poi colleghi Render a quel repository.

### Passo 1 — Carica il progetto su GitHub

1. Vai su **github.com** e crea un account gratuito (se non ne hai già uno).
2. In alto a destra premi **+** → **New repository**. Dagli un nome, es. `asta-fantacalcio`, lascialo **Public** o **Private** (indifferente ai fini del funzionamento), poi **Create repository**.
3. Nella pagina del repository appena creato, clicca il link **uploading an existing file**.
4. Sul tuo computer estrai lo zip che ti ho dato, poi trascina nella pagina di GitHub **tutto il contenuto** della cartella `asta-fantacalcio` (incluso il file `server.js`, `package.json`, `README.md` e l'intera cartella `public` — trascinandola così com'è, GitHub ne mantiene la struttura).
5. In basso scrivi un messaggio a piacere (es. "primo caricamento") e premi **Commit changes**.

### Passo 2 — Collega Render

1. Vai su **render.com** e crea un account gratuito (puoi registrarti direttamente con l'account GitHub appena creato, così li collega in automatico).
2. Premi **New** → **Web Service**.
3. Seleziona il repository `asta-fantacalcio` che hai appena caricato (se non lo vedi, autorizza Render ad accedere ai tuoi repository GitHub quando te lo chiede).
4. Lascia i valori proposti: **Build Command** `npm install`, **Start Command** `npm start` (o `node server.js`), **Instance Type / Plan** → **Free**.
5. Premi **Create Web Service**. Dopo qualche minuto Render ti darà un indirizzo pubblico tipo `https://asta-fantacalcio.onrender.com`: quello è il link da condividere con tutti su WhatsApp.

Da quel momento, ogni volta che vuoi modificare qualcosa nel sito basta ricaricare i file aggiornati sullo stesso repository GitHub (stessa procedura del Passo 1): Render ripubblica da solo la nuova versione in automatico.

**Nota sul piano gratuito:** dopo un periodo di inattività Render "addormenta" il servizio, e il primo che apre il link dopo la pausa può aspettare fino a circa un minuto perché si risvegli. Conviene quindi aprire il link qualche minuto prima di iniziare l'asta, così è già sveglio per tutti gli altri.

### Alternativa senza GitHub: Replit (tutto dal browser, un solo servizio)

Se preferisci evitare del tutto GitHub, puoi caricare gli stessi file direttamente su **replit.com** (account gratuito → nuovo Repl Node.js → trascini i file → premi **Run**, che ti dà subito un link pubblico). Stesso risultato, un passaggio in meno, ma devi tenere la scheda di Replit aperta sul tuo computer per tutta la durata dell'asta.

> I nomi esatti dei pulsanti e i limiti dei piani gratuiti di questi servizi possono cambiare nel tempo: se qualcosa non corrisponde a quello che vedi sullo schermo, fammi sapere cosa trovi e ti aggiorno le istruzioni.

## In alternativa, se preferisci Netlify o Supabase

Netlify da solo non basta, perché pubblica solo siti statici e questo progetto ha bisogno di un piccolo server sempre acceso per sincronizzare l'asta. Con **Supabase** però si può fare a meno del server: lo stato dell'asta viene tenuto nel suo database in tempo reale gratuito, e il sito (diventato solo pagine statiche) si pubblica su Netlify o GitHub Pages — con il vantaggio che non si "addormenta" mai. Richiede però di riscrivere la parte di sincronizzazione e configurare un progetto Supabase: se preferisci questa strada, chiedimelo pure e te la preparo.

## Personalizzazioni facili

- **Importi dei tasti di rilancio**: nel file `public/index.html`, cerca `<div class="bid-grid"` e cambia i numeri nei `data-amt="..."` dei 5 pulsanti.
- **Durata predefinita del timer**: nel file `server.js`, cambia `DEFAULT_TIMER`.
- **Colori e stile**: tutto lo stile è nel blocco `<style>` in cima a `public/index.html`.
