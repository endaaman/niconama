const fs = require('fs')
const util = require('util')
const NicoliveAPI = require('nicolive-api').default
const w = util.promisify.bind(util)

function E(err) {
  console.error('[ERROR]', err)
  process.exit(1)
}

async function main() {
  const { argv } = process
  if (argv.length < 4) {
    console.error('email and password are needed')
    return
  }
  const email = argv[2]
  const password = argv[3]
  const client = await NicoliveAPI.login({email, password}).catch(E)
  w(fs.writeFile)('.session' , `${client.cookie}\n`).catch(E)
  console.log("SESSION ID has been written into .session")
}

main()
