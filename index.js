require('dotenv').config();
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const express = require('express');

// Setup SQLite database
const db = new sqlite3.Database('./usedCodes.db', (err) => {
  if (err) {
    console.error('❌ Error opening database:', err.message);
    process.exit(1);
  } else {
    console.log('✅ Database connected');
    db.run(`
      CREATE TABLE IF NOT EXISTS usedCodes (
        code TEXT PRIMARY KEY
      )
    `, (err) => {
      if (err) {
        console.error('❌ Failed to create table:', err.message);
      } else {
        console.log('✅ Table ensured');
      }
    });
  }
});

// Setup web server (for UptimeRobot)
const app = express();
const port = 3000;
app.get('/', (req, res) => res.send('🟢 Bot is alive!'));
app.listen(port, '0.0.0.0', () => {
  console.log(`🌐 Web server running at http://0.0.0.0:${port}`);
});

// Setup Discord bot
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel],
});

const pendingVerifications = new Map(); // userId => { robloxId, code }

function generateCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// Bot ready
client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

// Commands
client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;

  const args = message.content.trim().split(/\s+/);
  const command = args[0].toLowerCase();

  // !verify <username>
  if (command === '!verify') {
    const robloxUsername = args[1];
    if (!robloxUsername) {
      return message.reply('❗ Please provide your Roblox username. Usage: `!verify <username>`');
    }

    try {
      const res = await axios.post('https://users.roblox.com/v1/usernames/users', {
        usernames: [robloxUsername],
        excludeBannedUsers: true
      });

      const userData = res.data.data[0];
      if (!userData) return message.reply('❌ Roblox user not found.');

      const robloxId = userData.id;
      const code = generateCode();

      pendingVerifications.set(message.author.id, { robloxId, code });

      return message.reply(
        `✅ Paste this code into your **Roblox About Me**:\n\`\`\`${code}\`\`\`\nThen type \`!confirm\` when you're done.`
      );
    } catch (error) {
      console.error('❌ Roblox API error:', error.message);
      return message.reply('❌ Failed to fetch Roblox user info.');
    }
  }

  // !confirm
  if (command === '!confirm') {
    const entry = pendingVerifications.get(message.author.id);
    if (!entry) return message.reply('❗ You need to use `!verify <username>` first.');

    try {
      const profile = await axios.get(`https://users.roblox.com/v1/users/${entry.robloxId}`);
      const description = profile.data.description || '';

      if (description.includes(entry.code)) {
        // Check if code already used
        db.get('SELECT * FROM usedCodes WHERE code = ?', [entry.code], (err, row) => {
          if (err) {
            console.error('❌ DB SELECT Error:', err.message);
            return message.reply('❌ Internal database error.');
          }

          if (row) {
            return message.reply('❌ This code has already been used. Please restart verification.');
          }

          // Save new code to DB
          db.run('INSERT INTO usedCodes (code) VALUES (?)', [entry.code], (err) => {
            if (err) {
              console.error('❌ DB INSERT Error:', err.message);
              return message.reply('❌ Failed to store verification code.');
            }

            // Assign "Verified" role
            const role = message.guild.roles.cache.find(r => r.name === 'Citzen');
            if (!role) return message.reply('❌ Could not find a role named "Verified". Please create one.');

            const member = message.guild.members.cache.get(message.author.id);
            if (!member) return message.reply('❌ Failed to find your Discord account in the server.');

            member.roles.add(role)
              .then(() => {
                pendingVerifications.delete(message.author.id);
                message.reply('🎉 You are now verified and have been given the **Verified** role!');
              })
              .catch((err) => {
                console.error('❌ Role assignment failed:', err.message);
                message.reply('❌ Failed to assign role.');
              });
          });
        });
      } else {
        return message.reply('❌ Verification code not found in your Roblox profile. Double-check your About Me.');
      }
    } catch (err) {
      console.error('❌ Roblox profile error:', err.message);
      return message.reply('❌ Error while checking your Roblox profile.');
    }
  }
});

// Start bot
client.login(process.env.DISCORD_TOKEN);
