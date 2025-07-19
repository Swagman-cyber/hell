require('dotenv').config();
const { Client, GatewayIntentBits, Partials, EmbedBuilder, PermissionsBitField } = require('discord.js');
const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();

// Setup SQLite database
const db = new sqlite3.Database('./usedCodes.db', (err) => {
  if (err) return console.error('Error opening database:', err.message);
  console.log('Database connected');
  db.run('CREATE TABLE IF NOT EXISTS usedCodes (code TEXT PRIMARY KEY, robloxId TEXT)');
});

const express = require('express');
const app = express();
const port = 3000;

app.get('/', (_, res) => res.send('Bot is running!'));
app.listen(port, '0.0.0.0', () => console.log(`Server running at http://0.0.0.0:${port}`));

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel],
});

const pendingVerifications = new Map();
let verificationEnabled = true;
const verificationRoleName = 'Participants';

function generateCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;

  const args = message.content.trim().split(/\s+/);
  const command = args[0].toLowerCase();

  if (command === '!verify') {
    if (!verificationEnabled) return message.reply('❌ Verification is currently disabled.');
    const robloxUsername = args[1];
    if (!robloxUsername) return message.reply('❗ Usage: !verify <roblox_username>');

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

      const embed = new EmbedBuilder()
        .setTitle('Roblox Verification')
        .setDescription(`Paste this code into your Roblox **About Me**:
\`${code}\`
Then use \`!confirm\`.`)
        .setColor('Green')
        .setThumbnail(`https://www.roblox.com/headshot-thumbnail/image?userId=${robloxId}&width=420&height=420&format=png`)
        .setURL(`https://www.roblox.com/users/${robloxId}/profile`);

      message.reply({ embeds: [embed] });
    } catch (err) {
      console.error(err);
      message.reply('❌ Error retrieving Roblox user info.');
    }
  }

  if (command === '!confirm') {
    const entry = pendingVerifications.get(message.author.id);
    if (!entry) return message.reply('❗ You need to run `!verify <username>` first.');

    try {
      const res = await axios.get(`https://users.roblox.com/v1/users/${entry.robloxId}`);
      if (!res.data.description.includes(entry.code)) {
        return message.reply('❌ Code not found in your About Me. Please check and try again.');
      }

      db.get('SELECT * FROM usedCodes WHERE code = ? AND robloxId = ?', [entry.code, entry.robloxId], (err, row) => {
        if (row) return message.reply('❌ Code has already been used.');

        db.run('INSERT INTO usedCodes (code, robloxId) VALUES (?, ?)', [entry.code, entry.robloxId], async (err) => {
          if (err) return message.reply('❌ DB error. Try again later.');

          const member = message.guild.members.cache.get(message.author.id);
          const role = message.guild.roles.cache.find(r => r.name.toLowerCase() === verificationRoleName.toLowerCase());

          if (!role) return message.reply(`❌ Role "${verificationRoleName}" not found.`);

          try {
            await member.roles.add(role);
            pendingVerifications.delete(message.author.id);

            const embed = new EmbedBuilder()
              .setTitle('✅ Verified!')
              .setDescription(`You've been verified and assigned the **${verificationRoleName}** role!`)
              .setColor('Green')
              .setThumbnail(`https://www.roblox.com/headshot-thumbnail/image?userId=${entry.robloxId}&width=420&height=420&format=png`);

            message.reply({ embeds: [embed] });
          } catch (err) {
            console.error(err);
            message.reply('❌ Could not assign role.');
          }
        });
      });
    } catch (err) {
      console.error(err);
      message.reply('❌ Could not verify. Try again later.');
    }
  }

  if (command === '!settings' && message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
    const embed = new EmbedBuilder()
      .setTitle('Settings')
      .setDescription(`Verification: ${verificationEnabled ? 'Enabled' : 'Disabled'}\nRole: ${verificationRoleName}`)
      .setColor('Blue');
    message.reply({ embeds: [embed] });
  }

  if (command === '!toggleverify' && message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
    verificationEnabled = !verificationEnabled;
    message.reply(`✅ Verification is now ${verificationEnabled ? 'enabled' : 'disabled'}.`);
  }
});

client.login(process.env.DISCORD_TOKEN);
