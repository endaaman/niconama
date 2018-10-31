const readline = require('readline')
const fs = require('fs')
const util = require('util')
const exec = require('child_process').exec
const NicoliveAPI = require('nicolive-api').default
const shellQuote = require('shell-quote')
const notifier = require('node-notifier')

const VOICE_FILE = './voices/mei_normal.htsvoice'
const SETTINGS_FILE = './settings.json'

const w = util.promisify.bind(util)
let current = new Promise((r) => { r() })


function say(message) {
  const handler = () => {
    return sayInner(message).catch(E)
  }
  current = current.then(handler, handler)
}

async function sayInner(message) {
  const fn = '/tmp/voice.wav'
  const cmd =
    `echo '${message}' | open_jtalk -m ${VOICE_FILE} -x ./naist-jdic -ow ${fn} && play -q ${fn}`
  await w(exec)(cmd).catch(E)
}

function E(err) {
  console.error('[ERROR]', err)
  say('エラーが起きたよ')
  process.exit(1)
}

async function getClient() {
  // const client = await NicoliveAPI.login({
  //   email:process.env.EMAIL,
  //   password: process.env.PASSWORD
  // })
  // console.log('Logged in')
  return  new NicoliveAPI(process.env.SESSION)
}

async function main() {
  const { argv } = process
  if (argv.length < 3) {
    console.error('Streaming ID is needed.')
    return
  }
  const lv = argv[2]

  const client = await getClient().catch(E)

  const con = await client.connectLive(lv).catch(E)
  console.log(`[${lv}]`)
  con.viewer.connection.on('comment', onComment)
  con.viewer.connection.on('ejected', () => {
    console.log('追い出されました')
    con.disconnect()
  })

  readline.emitKeypressEvents(process.stdin)
  process.stdin.setRawMode(true)
  process.stdin.on('keypress', (str, key) => {
    if (key.ctrl && key.name === 'c') {
      process.exit()
      return
    }
    if (!key.ctrl && key.name === 'q') {
      console.log('Quiting..')
      process.exit()
      return
    }
  })
}


const commands = [
  {
    cmd: ['add', 'teach', '調教'],
    func: async (argv, settings) => {
      if (argv.length !== 3) {
        say('書式がおかしいよ')
        return
      }
      const reg = argv[1].toLowerCase()
      for (replacer of settings.replacers) {
        if (replacer.reg === reg) {
          say(`もう知ってる ${replacer.text}だよね`)
          return
        }
      }
      const n = {
        ids: settings.ids,
        replacers: settings.replacers.concat([
          {
            reg: argv[1],
            text: argv[2],
          }
        ])
      }
      await saveSettings(n).catch(E)
      say(`${argv[1]}の読み方は${argv[2]}と教えてもらいました`)
    }
  }, {
    cmd: ['remove', 'forget', '忘却'],
    func: async (argv, settings) => {
      if (argv.length !== 2) {
        say('書式がおかしいよ')
        return
      }
      const reg = argv[1].toLowerCase()
      for (const i in settings.replacers) {
        const replacer = settings.replacers[i]
        if (replacer.reg === reg) {
          const r = settings.replacers.slice()
          r.splice(i, 1)
          const n = {
            ids: settings.ids,
            replacers: r,
          }
          await saveSettings(n).catch(E)
          say(`${replacer.text}の読み方を忘れました`)
          return
        }
      }
      say(`${argv[1]}の読み方を知らないよ`)
    }
  }
]

async function loadSettings() {
  const text = await w(fs.readFile)(SETTINGS_FILE, 'utf-8').catch(E)
  return JSON.parse(text)
}

async function saveSettings(settings) {
  await w(fs.writeFile)(SETTINGS_FILE, JSON.stringify(settings, null, 2)).catch(E)
}

function getReadableMessage(rawMessage, settings) {
  const reversedReplacers = settings.replacers.slice().reverse()
  let message = rawMessage
  for (const replacer of reversedReplacers) {
    const reg = new RegExp(replacer.reg, 'ig')
    message = message.replace(reg, replacer.text)
  }
  return message
}

async function postprocessMessage(message) {
}

async function onComment(comment) {
  // log
  let id = comment.attr.user_id
  if (/\d+/.test(id)) {
    id = id.substr(0, 6)
  }
  console.log(`[COMMENT] ${id} - ${comment.text}`)
  notifier.notify({
    title: id,
    message: comment.text
  })

  // load settings
  const settings = await loadSettings().catch(E)

  // process if comment is command
  const splitted = shellQuote.parse(comment.text)
  for (const command of commands) {
    if (command.cmd.includes(splitted[0])) {
      await command.func(splitted, settings).catch(E)
      return
    }
  }
  // TODO: process kotehan
  // const matched = comment.text.match(/@(\S+)/i)
  // if (matched) {
  //   matched[1]
  // }
  say(getReadableMessage(comment.text, settings))
}

// onComment({
//   attr: {
//     user_id: 'hoge',
//   },
//   text: 'add hoge ホゲ'
// })

main()
