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
const commentSet = new Set()

class Context {
  constructor(client, manager) {
    this.client = client
    this.manager = manager
  }
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
        users: settings.users,
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
            users: settings.users,
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

async function main() {
  const { argv } = process
  if (argv.length < 3) {
    console.error('Streaming ID is needed.')
    return
  }
  const lv = argv[2]

  const sessionText = (await w(fs.readFile)('.session', 'utf-8').catch(E))
  const session = sessionText.split('\n').join('')
  const client = new NicoliveAPI(session)
  const manager = await client.connectLive(lv).catch(E)
  const context = new Context(client, manager)

  console.log(`[${lv}]`)
  manager.viewer.connection.on('comment', onComment.bind(context))
  manager.viewer.connection.on('ejected', () => {
    console.log('追い出されました')
    manager.disconnect()
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
  await onComment.bind(context)({
    attr: {
      user_id: '1276437',
    },
    text: '読み上げ開始'
  })
}

async function loadSettings() {
  const text = await w(fs.readFile)(SETTINGS_FILE, 'utf-8').catch(E)
  return JSON.parse(text)
}

async function saveSettings(settings) {
  await w(fs.writeFile)(SETTINGS_FILE, JSON.stringify(settings, null, 2)).catch(E)
}

function convertToReadableMessage(rawMessage, settings) {
  const reversedReplacers = settings.replacers.slice().reverse()
  let message = rawMessage
  for (const replacer of reversedReplacers) {
    const reg = new RegExp(replacer.reg, 'ig')
    message = message.replace(reg, replacer.text)
  }
  return message
}

async function getUserName(context, settings, id) {
  for (const user of settings.users) {
    if (user.id === id) {
      return user.name
    }
  }
  if (!/^\d+$/.test(id)) { // if 184
    return id.substr(0, 6)
  }
  if (id === '900000000') {
    return '放送主'
  }
  const status = await context.client.getUserInfo(id).catch((e) => {
    console.warn(`[WARN] not found user id: ${id}`)
    return {
      nickname: id
    }
  })
  const name = status.nickname
  ///* caching automatically */
  // const user = { id, name }
  // const n = {
  //   users: settings.users.concat([ user ]),
  //   replacers: settings.replacers.slice()
  // }
  // await saveSettings(n).catch(E)
  return name
}

async function onComment(comment) {
  const context = this

  let rawUserId = comment.attr.user_id
  const rawMessage = comment.text
  const commentId = `${rawUserId}_${rawMessage}`
  if (commentSet.has(commentId)) {
    // skip duplicated
    return
  }
  commentSet.add(commentId)

  // load settings
  const settings = await loadSettings().catch(E)

  const userName = await getUserName(context, settings, rawUserId).catch(E)
  notifier.notify({
    title: `${userName}`,
    message: rawMessage
  })
  console.log(`[COMMENT] ${userName} - ${rawMessage}`)

  // process if comment is command
  const splitted = shellQuote.parse(rawMessage)
  for (const command of commands) {
    if (command.cmd.includes(splitted[0])) {
      await command.func(splitted, settings).catch(E)
      return
    }
  }
  // TODO: process kotehan
  // const matched = rawMessage.match(/@(\S+)/i)
  // if (matched) {
  //   matched[1]
  // }
  say(convertToReadableMessage(rawMessage, settings))
}

main()
