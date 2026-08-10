# Burraco 1 vs 1 — versione 0.1

Prima base online del gioco: due giocatori, stanza privata, distribuzione reale dal server e turni sincronizzati.

## Cosa funziona già

- creazione stanza con codice di 6 caratteri;
- ingresso del secondo giocatore anche da un'altra rete;
- 2 mazzi francesi + 4 jolly = 108 carte;
- 11 carte a testa;
- 2 pozzetti da 11 carte;
- tallone e monte scarti;
- turno iniziale casuale;
- pesca di una carta dal tallone;
- raccolta dell'intero monte scarti;
- selezione e scarto di una carta;
- passaggio automatico del turno;
- carte avversarie mai inviate al browser dell'altro giocatore;
- ordinamento locale per seme o valore;
- riconnessione tramite token salvato nel browser;
- layout responsive per telefono e PC.

## Cosa aggiungiamo nella versione successiva

- apertura di scale e gruppi;
- trascinamento delle carte sul tavolo;
- controllo completo delle combinazioni;
- pinelle e jolly nelle combinazioni;
- burraco pulito/sporco;
- presa del pozzetto;
- chiusura;
- conteggio punti;
- rematch e storico partite.

## Avvio sul PC

Serve Node.js 18 o superiore.

```bash
npm install
npm start
```

Poi apri:

```text
http://localhost:3000
```

Per provarlo da solo puoi aprire una finestra normale e una finestra in incognito, usando due nomi diversi.

## Pubblicazione su Render

Crea un nuovo **Web Service** collegato al repository del progetto.

- Build Command: `npm install`
- Start Command: `npm start`

Il server usa automaticamente la variabile `PORT` fornita dall'hosting.

## Nota

Questa è volutamente la base di rete e turnazione. La logica delle combinazioni viene aggiunta separatamente così il server può validare ogni mossa senza fidarsi del client.
