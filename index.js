require('dotenv').config();
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const express = require('express');

// --- Database Setup ---
const db = new sqlite3.Database('./usedCodes.db', (err) => {
  if (err) {
    console.error('❌ Error opening database:', err.message);
  } else {
    console.log('📦 Database connected');
    db.run('CREATE TABLE IF NOT EXISTS usedCodes (code TEXT PRIMARY KEY)', (err) => {
      if (err) console.error('❌ Error creating table:', err.message);
    });
  }
});

// --- Web Server (Uptime Ping) ---
const app = express();
const port = 3000;
app.get('/', (req, res) => res.send('✅ AvatarCheck is running!'));
app.listen(port, '0.0.0.0', () => {
  console.log(`🌐 Uptime server active on http://0.0.0.0:${port}`);
});

// --- Discord Client Setup ---
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

const pendingVerifications = new Map(); // userId => { robloxId, code }

function generateCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// --- Bot Ready ---
client.once('ready', async () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);
});

// --- Message Listener ---
client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;

  const args = message.content.trim().split(/\s+/);
  const command = args[0].toLowerCase();

  // Step 1: !verify <username>
  if (command === '!verify') {
    const robloxUsername = args[1];
    if (!robloxUsername) {
      return message.reply('❗ Please use: `!verify <robloxUsername>`');
    }

    try {
      const res = await axios.post('https://users.roblox.com/v1/usernames/users', {
        usernames: [robloxUsername],
        excludeBannedUsers: true,
      });

      const userData = res.data.data[0];
      if (!userData) return message.reply('❌ Roblox user not found.');

      const robloxId = userData.id;
      const code = generateCode();

      pendingVerifications.set(message.author.id, { robloxId, code });

      return message.reply(
        `📋 Add this code to your **Roblox About Me**:\n\`\`\`${code}\`\`\`\nThen type \`!confirm\` to complete verification.`
      );
    } catch (error) {
      console.error(error);
      return message.reply('❌ Failed to fetch Roblox user info.');
    }
  }

  // Step 2: !confirm
  if (command === '!confirm') {
    const entry = pendingVerifications.get(message.author.id);
    if (!entry) return message.reply('❗ Use `!verify <username>` first.');

    try {
      const profile = await axios.get(`https://users.roblox.com/v1/users/${entry.robloxId}`);
      const description = profile.data.description || '';

      if (!description.includes(entry.code)) {
        return message.reply('❌ Verification code not found in your Roblox profile.');
      }

      db.get('SELECT * FROM usedCodes WHERE code = ?', [entry.code], (err, row) => {
        if (err) {
          console.error('DB Error:', err);
          return message.reply('❌ Internal DB error.');
        }

        if (row) {
          return message.reply('❌ This verification code has already been used.');
        }

        db.run('INSERT INTO usedCodes (code) VALUES (?)', [entry.code], (err) => {
          if (err) {
            console.error('DB Insert Error:', err);
            return message.reply('❌ Failed to save verification code.');
          }

          const verifiedRole = message.guild.roles.cache.find(r => r.name === 'Verified');
          const member = message.guild.members.cache.get(message.author.id);

          if (!verifiedRole) {
            return message.reply('❌ Role "Verified" not found. Please ask an admin to create it.');
          }

          if (!member) {
            return message.reply('❌ Could not find your server membership.');
          }

          member.roles.add(verifiedRole)
            .then(() => {
              pendingVerifications.delete(message.author.id);
              message.reply('✅ Verification complete! You have been given the **Verified** role.');
            })
            .catch((err) => {
              console.error('Role Assignment Error:', err);
              message.reply('❌ Failed to assign the Verified role.');
            });
        });
      });
    } catch (err) {
      console.error('Verification Error:', err);
      return message.reply('❌ Failed to verify your Roblox account.');
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
