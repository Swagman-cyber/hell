require('dotenv').config();
const { Client, GatewayIntentBits, Partials, EmbedBuilder, REST, Routes, SlashCommandBuilder, InteractionType } = require('discord.js');
const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const express = require('express');

// =========================
// EXPRESS WEB KEEP-ALIVE
// =========================
const app = express();
const port = 3000;

app.get('/', (req, res) => {
  res.send('Bot is running!');
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Server running at http://0.0.0.0:${port}`);
});

// =========================
// DISCORD CLIENT SETUP
// =========================
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
  partials: [Partials.Channel],
});

const pendingVerifications = new Map(); // userId => { robloxId, code }

// =========================
// DATABASE SETUP
// =========================
const db = new sqlite3.Database('./usedCodes.db', (err) => {
  if (err) return console.error('DB Error:', err.message);
  db.run('CREATE TABLE IF NOT EXISTS usedCodes (code TEXT PRIMARY KEY, robloxId TEXT)');
});

function generateCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// =========================
// SLASH COMMANDS REGISTER
// =========================
const commands = [
  new SlashCommandBuilder().setName('verify').setDescription('Start Roblox verification').addStringOption(opt =>
    opt.setName('username').setDescription('Your Roblox username').setRequired(true)),
  new SlashCommandBuilder().setName('confirm').setDescription('Confirm your Roblox verification')
];

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

client.once('ready', async () => {
  try {
    await rest.put(Routes.applicationGuildCommands(client.user.id, process.env.GUILD_ID), { body: commands });
    console.log('✅ Slash commands registered.');
  } catch (err) {
    console.error('❌ Error registering commands:', err);
  }

  console.log(`✅ Logged in as ${client.user.tag}`);
});

// =========================
// SLASH COMMAND HANDLER
// =========================
client.on('interactionCreate', async (interaction) => {
  if (interaction.type !== InteractionType.ApplicationCommand) return;

  const { commandName } = interaction;

  // /verify command
  if (commandName === 'verify') {
    const robloxUsername = interaction.options.getString('username');

    try {
      const res = await axios.post('https://users.roblox.com/v1/usernames/users', {
        usernames: [robloxUsername],
        excludeBannedUsers: true
      });

      const userData = res.data.data[0];
      if (!userData) return interaction.reply({ content: '❌ Roblox user not found.', ephemeral: true });

      const robloxId = userData.id;
      const code = generateCode();
      const profileImageUrl = `https://www.roblox.com/headshot-thumbnail/image?userId=${robloxId}&width=420&height=420&format=png`;
      const robloxProfileUrl = `https://www.roblox.com/users/${robloxId}/profile`;

      pendingVerifications.set(interaction.user.id, { robloxId, code });

      const embed = new EmbedBuilder()
        .setTitle('Roblox Verification')
        .setDescription(`✅ Paste this code into your Roblox About Me:\n\`\`\`${code}\`\`\`\nThen type \`/confirm\` when you're done.`)
        .setColor('Green')
        .setThumbnail(profileImageUrl)
        .setURL(robloxProfileUrl);

      return interaction.reply({ embeds: [embed], ephemeral: true });

    } catch (err) {
      console.error(err);
      return interaction.reply({ content: '❌ Failed to verify. Please try again.', ephemeral: true });
    }
  }

  // /confirm command
  if (commandName === 'confirm') {
    const entry = pendingVerifications.get(interaction.user.id);
    if (!entry) return interaction.reply({ content: '❗ Please use `/verify` first.', ephemeral: true });

    try {
      const profile = await axios.get(`https://users.roblox.com/v1/users/${entry.robloxId}`);
      const description = profile.data.description || '';

      if (description.includes(entry.code)) {
        db.get('SELECT * FROM usedCodes WHERE code = ? AND robloxId = ?', [entry.code, entry.robloxId], (err, row) => {
          if (err) return interaction.reply({ content: '❌ DB error occurred.', ephemeral: true });
          if (row) return interaction.reply({ content: '❌ This code has already been used.', ephemeral: true });

          db.run('INSERT INTO usedCodes (code, robloxId) VALUES (?, ?)', [entry.code, entry.robloxId], (err) => {
            if (err) return interaction.reply({ content: '❌ Failed to save verification.', ephemeral: true });

            const role = interaction.guild.roles.cache.find(r => r.name.toLowerCase() === 'citizen');
            const member = interaction.guild.members.cache.get(interaction.user.id);

            if (!role || !member) {
              return interaction.reply({ content: '❌ Role or member not found.', ephemeral: true });
            }

            member.roles.add(role)
              .then(() => {
                pendingVerifications.delete(interaction.user.id);
                interaction.reply({ content: '🎉 You are now verified and have been given the **Citizen** role!', ephemeral: true });
              })
              .catch(() => {
                interaction.reply({ content: '❌ Failed to assign role.', ephemeral: true });
              });
          });
        });
      } else {
        return interaction.reply({ content: '❌ Verification code not found in your profile.', ephemeral: true });
      }

    } catch (err) {
      console.error(err);
      return interaction.reply({ content: '❌ Error checking Roblox profile.', ephemeral: true });
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
