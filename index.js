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


function say(message) {
  const handler = () => {
    return sayInner(message).catch(E)
  }
  current = current.then(handler, handler)
}

async function sayInner(message) {
  if (!message) {
    return
  }
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

const commands = [
  {
    cmd: ['add', 'teach', '調教'],
    func: 'teachFunc',
  }, {
    cmd: ['remove', 'forget', '忘却'],
    func: 'forgetFunc',
  }
]

class Context {
  constructor(client, manager) {
    this.client = client
    this.manager = manager
    this.__settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'))
  }

  getSettings() {
    return JSON.parse(JSON.stringify(this.__settings))
  }

  async loadSettings() {
    const text = await w(fs.readFile)(SETTINGS_FILE, 'utf-8').catch(E)
    this.__settings = JSON.parse(text)
  }

  async updateSettings(settings) {
    this.__settings = await w(fs.writeFile)(SETTINGS_FILE, JSON.stringify(settings, null, 2)).catch(E)
  }

  async teachFunc(argv) {
    if (argv.length !== 3) {
      say('書式がおかしいよ')
      return
    }
    const s = this.getSettings()
    const reg = argv[1].toLowerCase()
    for (const replacer of s.replacers) {
      if (replacer.reg === reg) {
        say(`もう知ってる ${replacer.text}だよね`)
        return
      }
    }
    s.replacers.push({
      reg: argv[1],
      text: argv[2],
    })
    await this.updateSettings(s).catch(E)
    say(`${argv[1]}の読み方は${argv[2]}と教えてもらいました`)
  }

  async forgetFunc(argv) {
    if (argv.length !== 2) {
      say('書式がおかしいよ')
      return
    }
    const s = this.getSettings()
    const reg = argv[1].toLowerCase()
    for (const i in s.replacers) {
      const replacer = s.replacers[i]
      if (replacer.reg === reg) {
        s.replacers.splice(i, 1)
        await this.updateSettings(s).catch(E)
        say(`${replacer.text}の読み方を忘れました`)
        return
      }
    }
    say(`${argv[1]}の読み方を知らないよ`)
  }

  async registerUserName(id, name) {
    const user = { id, name }
    const s = this.getSettings()
    s.users.push({ id, name })
    await this.updateSettings(s).catch(E)
    say(`${name}さんの名前を登録しました`)
  }

  async getUserName(id) {
    const users = this.getSettings().users.slice()
    users.reverse()
    for (const user of users) {
      if (user.id === id) {
        return user.name
      }
    }
    if (!/^\d+$/.test(id)) { // if 184
      return id.substr(0, 10)
    }
    const status = await this.client.getUserInfo(id).catch((e) => {
      console.warn(`[WARN] not found user id: ${id}`)
      return {
        nickname: id
      }
    })
    const name = status.nickname
    return name
  }

  convertToReadableMessage(rawMessage) {
    const reversedReplacers = this.getSettings().replacers.slice().reverse()
    let message = rawMessage
    for (const replacer of reversedReplacers) {
      const reg = new RegExp(replacer.reg, 'ig')
      message = message.replace(reg, replacer.text)
    }
    return message
  }

  async onComment(comment) {
    let rawUserId = comment.attr.user_id
    const rawMessage = comment.text
    const commentId = `${rawUserId}_${rawMessage}`
    if (commentSet.has(commentId)) {
      // skip duplicated
      return
    }
    commentSet.add(commentId)

    await this.loadSettings().catch(E)
    const userName = await this.getUserName(rawUserId).catch(E)
    notifier.notify({
      title: `${userName}`,
      message: rawMessage
    })
    console.log(`[COMMENT] ${userName} - ${rawMessage}`)

    // process if comment is command
    const splitted = shellQuote.parse(rawMessage)
    for (const command of commands) {
      if (command.cmd.includes(splitted[0])) {
        await this[command.func](splitted).catch(E)
        return
      }
    }
    // TODO: process kotehan
    const matched = rawMessage.match(/(@|＠)(\S+)/i)
    if (matched) {
      await this.registerUserName(rawUserId, matched[2])
      return
    }
    say(this.convertToReadableMessage(rawMessage))
  }
}

async function main() {
  const { argv } = process
  if (argv.length < 3) {
    console.error('Streaming ID is needed.')
    return
  }
  const matched = argv[2].match(/[0-9]{9}/)
  if (!matched) {
    console.error('Invalid steam ID')
    return
  }
  const lv = `lv${matched[0]}`

  const sessionText = (await w(fs.readFile)('.session', 'utf-8').catch(E))
  const session = sessionText.split('\n').join('')
  const client = new NicoliveAPI(session)
  const manager = await client.connectLive(lv).catch(E)
  const context = new Context(client, manager)

  console.log(`[${lv}]`)
  manager.viewer.connection.on('comment', context.onComment.bind(context))
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
  await context.onComment({
    attr: {
      user_id: '1276437',
    },
    text: '読み上げ開始'
  })
}

main()
