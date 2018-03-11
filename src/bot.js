const Bot = require('./lib/Bot')
const SOFA = require('sofa-js')
const Fiat = require('./lib/Fiat')
const Logger = require('./lib/Logger');
const PsqlStore = require('./PsqlStore');

var bot = new Bot()

const DATABASE_TABLES = `
CREATE TABLE IF NOT EXISTS givotak_history (
    givotak_id BIGSERIAL PRIMARY KEY,
    toshi_id_tak VARCHAR NOT NULL,
    tak_amount REAL,
    tak_coin VARCHAR,
    toshi_id_giv VARCHAR,
    date TIMESTAMP WITHOUT TIME ZONE DEFAULT (now() AT TIME ZONE 'utc')
);
`;

const GIVE_OR_TAKE = [
  {type: 'button', label: 'Give', value: 'give'}, 
  {type: 'button', label: 'Take', value: 'take'},
];

bot.onReady = () => {
  bot.dbStore = new PsqlStore(bot.client.config.storage.postgres.url, process.env.STAGE || 'development');
  bot.dbStore.initialize(DATABASE_TABLES).then(() => {}).catch((err) => {
    Logger.error(err);
  });
};

// ROUTING

bot.onEvent = function(session, message) {

  if (session.user.is_app) {
      return;
  }

  switch (message.type) {
    case 'Init':
      welcome(session)
      break
    case 'Message':
      onMessage(session, message)
      break
    case 'Command':
      onCommand(session, message)
      break
  }
}

function onMessage(session, message) {
  var step = session.get('step');
  var o = session.get('o');
  switch (step){
      case 'begin':
        session.set('coinType', message.body);
        session.set('step', 'coin type');
        break;
      case 'coin type':
        session.set('coinAmount', message.body);
        session.set('step', 'coin amount');
        break;
    }
  if (o == 'tak') {   
    take(session);
  } else if (o == 'giv'){
    give(session);
  } else { // o == 'o'
    welcome(session);
  }
}

function onCommand(session, command) {
  session.set('step', 'begin');
  switch (command.content.value) {
    case 'give':
      session.set('o', 'giv');
      give(session);
      break;
    case 'take':
      session.set('o', 'tak');
      take(session);
      break;
    }
}

// STATES

function welcome(session) {
  session.set('o', 'o');
  session.set('step', 'begin');
  session.reply(SOFA.Message({
    body: "Give Or Take?",
    controls: GIVE_OR_TAKE,
    showKeyboard: false
  }));
};

function closest (num, arr) {
  var curr = arr[0];
  var diff = Math.abs (num - curr);
  for (var val = 0; val < arr.length; val++) {
      var newdiff = Math.abs (num - arr[val]);
      if (newdiff < diff) {
          diff = newdiff;
          curr = arr[val];
      }
  }
  return curr;
}

function take(session) {
  var step = session.get('step');
  switch(step){
    case 'begin':
      session.reply(SOFA.Message({
        body: "What coin do you want to take (ETH, 1ST, DATA, ...)?",
        showKeyboard: true
      }));
      break;
    case 'coin type':
      var coinType = session.get('coinType');
      bot.dbStore.fetchval("SELECT COUNT(*) FROM givotak_history where tak_coin = $1 and age(now(), date) < '2 minutes'",
                     [coinType]).then((count) => {
                      switch (count){
                        case '0':
                          session.reply(SOFA.Message({
                            body: "There is no giv for the coin. Have another?",
                            controls: GIVE_OR_TAKE,
                            showKeyboard: false
                          }));
                          break;
                        case '1':
                          bot.dbStore.fetch("SELECT * FROM givotak_history where tak_coin = $1 and age(now(), date) < '2 minutes'",
                            [coinType]).then((rows) => {
                              var body = "\uD83D\uDCAC @" + rows[0].toshi_id_tak + "\n";
                              session.reply(SOFA.Message({
                                body: body + "I give " + rows[0].tak_amount + " " + rows[0].tak_coin + "."
                              }));
                              session.reply(SOFA.Message({
                                 body: "That was lone. Have another?",
                                 controls: GIVE_OR_TAKE,
                                 showKeyboard: false
                              }));
                            }).catch((err) => {
                                session.reply(SOFA.Message({
                                   body: "An error occured: " + err + "\n Do you want to try again?",
                                   controls: GIVE_OR_TAKE,
                                   showKeyboard: false
                                }));
                              });
                          break;
                        default:
                          if (parseInt(count) > 1){
                            session.reply(SOFA.Message({
                              body: "What amount do you want to take?",
                              showKeyboard: true
                            }));
                          } else {
                            session.reply(SOFA.Message({
                                   body: "An error occured: " + "Count is: " + count + "\n Do you want to try again?",
                                   controls: GIVE_OR_TAKE,
                                   showKeyboard: false
                            }));
                          }
                          break;
                     }
                   }).catch((err) => {
                        session.reply(SOFA.Message({
                                   body: "An error occured: " + err + "\n Do you want to try again?",
                                   controls: GIVE_OR_TAKE,
                                   showKeyboard: false
                        }));
                      });
      break;
    case 'coin amount':
      var coinType = session.get('coinType');
      var coinAmount = session.get('coinAmount');
      bot.dbStore.fetch("SELECT * FROM givotak_history where tak_coin = $1 and age(now(), date) < '2 minutes'",
                            [coinType]).then((rows) => {
                              var rowsAmount = rows.map((row) => row.tak_amount);
                              var closestAmount = closest(coinAmount, rowsAmount);
                              var rowBest = rows.find((row) => row.tak_amount == closestAmount);
                              var body = "\uD83D\uDCAC @" + rowBest.toshi_id_tak + "\n";
                              session.reply(SOFA.Message({
                                body: body + "I give " + rowBest.tak_amount + " " + rowBest.tak_coin + "." ,
                              }));
                              session.reply(SOFA.Message({
                                 body: "That was best. Have another?",
                                 controls: GIVE_OR_TAKE,
                                 showKeyboard: false
                              }));
                            }).catch((err) => {
                                session.reply(SOFA.Message({
                                   body: "An error occured: " + err + "\n Do you want to try again?",
                                   controls: GIVE_OR_TAKE,
                                   showKeyboard: false
                                }));
                              });
      break;     
  }
}

function give(session) {
  var step = session.get('step');
    switch(step){
      case 'begin':
        session.reply(SOFA.Message({
          body: "What coin do you want to give (ETH, 1ST, DATA, ...)?",
          showKeyboard: true
        }));
        break;
      case 'coin type':
        session.reply(SOFA.Message({
          body: "What amount do you want to give?",
          showKeyboard: true
        }));
        break;
      case 'coin amount':
        var coinAmount = session.get('coinAmount');
        var coinType = session.get('coinType');
        bot.dbStore.execute("INSERT INTO givotak_history (toshi_id_tak, tak_amount, tak_coin, toshi_id_giv, date) VALUES ($1, $2, $3, NULL, now() AT TIME ZONE 'utc')", [session.user.username, coinAmount, coinType])
          .then(() => {
            session.reply(SOFA.Message({
              body: "You gave, now wait for a taker! Have another?",
              controls: GIVE_OR_TAKE,
              showKeyboard: false
            }));
          }).catch((err) => {
              session.reply(SOFA.Message({
                body: "An error occured: " + err + "\n Do you want to try again?",
                controls: GIVE_OR_TAKE,
                showKeyboard: false
              }));
            });;
        break;
  }
}

function donate(session) {
  // request $1 USD at current exchange rates
  Fiat.fetch().then((toEth) => {
    session.requestEth(toEth.USD(1))
  })
}

// HELPERS

function sendMessage(session, message) {
  session.reply(SOFA.Message({
    body: message,
    controls: GIVE_OR_TAKE,
    showKeyboard: false,
  }))
}