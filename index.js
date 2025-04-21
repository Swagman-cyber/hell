require('dotenv').config();
const { Client, GatewayIntentBits, Partials, REST, Routes, SlashCommandBuilder, EmbedBuilder, PermissionsBitField } = require('discord.js');
const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const express = require('express');

// SQLite setup
const db = new sqlite3.Database('./usedCodes.db', (err) => {
  if (err) return console.error('DB error:', err);
  console.log('✅ SQLite connected');

  db.all("PRAGMA table_info(usedCodes);", (err, rows) => {
    if (!rows.length || !rows.some(row => row.name === 'robloxId')) {
      db.run('DROP TABLE IF EXISTS usedCodes');
      db.run('CREATE TABLE usedCodes (code TEXT PRIMARY KEY, robloxId TEXT)');
      console.log('✅ usedCodes table reset');
    } else {
      console.log('✅ Table schema is valid');
    }
  });
});

// Web express listener
const app = express();
app.get('/', (_, res) => res.send('AvatarCheck is online!'));
app.listen(3000, '0.0.0.0', () => console.log('🌐 Express server running'));

// Discord bot setup
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
  partials: [Partials.Channel],
});

const pendingVerifications = new Map(); // userId -> { robloxId, code }
let verificationEnabled = true;
let verificationRoleName = 'Citizen';

function generateCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// Slash Commands
const commands = [
  new SlashCommandBuilder()
    .setName('verify')
    .setDescription('Start the Roblox verification process')
    .addStringOption(option =>
      option.setName('username').setDescription('Your Roblox username').setRequired(true)),
  new SlashCommandBuilder()
    .setName('confirm')
    .setDescription('Confirm you’ve added the code to your About Me'),
  new SlashCommandBuilder()
    .setName('disableverification')
    .setDescription('Toggle verification system on/off')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),
  new SlashCommandBuilder()
    .setName('setverrole')
    .setDescription('Set the role to give verified users')
    .addStringOption(option =>
      option.setName('rolename').setDescription('The name of the role').setRequired(true))
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),
  new SlashCommandBuilder()
    .setName('verifystatus')
    .setDescription('View current verification settings')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
];

client.once('ready', async () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(Routes.applicationGuildCommands(client.user.id, process.env.GUILD_ID), {
      body: commands,
    });
    console.log('✅ Slash commands registered');
  } catch (err) {
    console.error('❌ Failed to register commands:', err);
  }
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName, options, member, guild, user } = interaction;

  if (commandName === 'verify') {
    if (!verificationEnabled) return interaction.reply({ content: '❌ Verification is disabled.', ephemeral: true });

    const username = options.getString('username');
    try {
      const res = await axios.post('https://users.roblox.com/v1/usernames/users', {
        usernames: [username],
        excludeBannedUsers: true
      });
      const data = res.data.data[0];
      if (!data) return interaction.reply({ content: '❌ Roblox user not found.', ephemeral: true });

      const robloxId = data.id;
      const code = generateCode();
      pendingVerifications.set(user.id, { robloxId, code });

      const embed = new EmbedBuilder()
        .setTitle('Roblox Verification')
        .setDescription(`Paste this code into your Roblox **About Me**:\n\`\`\`${code}\`\`\`\nThen use \`/confirm\` once done.`)
        .setThumbnail(`https://www.roblox.com/headshot-thumbnail/image?userId=${robloxId}&width=420&height=420&format=png`)
        .setURL(`https://www.roblox.com/users/${robloxId}/profile`)
        .setColor('Green');

      return interaction.reply({ embeds: [embed], ephemeral: true });

    } catch (err) {
      console.error(err);
      return interaction.reply({ content: '❌ Failed to fetch Roblox user.', ephemeral: true });
    }
  }

  if (commandName === 'confirm') {
    const entry = pendingVerifications.get(user.id);
    if (!entry) return interaction.reply({ content: '❗ Use `/verify` first.', ephemeral: true });

    try {
      const profile = await axios.get(`https://users.roblox.com/v1/users/${entry.robloxId}`);
      const description = profile.data.description || '';
      if (!description.includes(entry.code)) {
        return interaction.reply({ content: '❌ Code not found in your About Me.', ephemeral: true });
      }

      db.get('SELECT * FROM usedCodes WHERE code = ? AND robloxId = ?', [entry.code, entry.robloxId], (err, row) => {
        if (row) return interaction.reply({ content: '❌ This code has already been used.', ephemeral: true });

        db.run('INSERT INTO usedCodes (code, robloxId) VALUES (?, ?)', [entry.code, entry.robloxId]);

        const role = guild.roles.cache.find(r => r.name.toLowerCase() === verificationRoleName.toLowerCase());
        if (!role) return interaction.reply({ content: `❌ Role "${verificationRoleName}" not found.`, ephemeral: true });

        const memberObj = guild.members.cache.get(user.id);
        memberObj.roles.add(role)
          .then(() => {
            pendingVerifications.delete(user.id);
            interaction.reply({ content: `🎉 Verified! You now have the **${verificationRoleName}** role.`, ephemeral: false });
          })
          .catch(() => interaction.reply({ content: '❌ Failed to assign role.', ephemeral: true }));
      });

    } catch (err) {
      console.error(err);
      interaction.reply({ content: '❌ Error checking your profile.', ephemeral: true });
    }
  }

  if (commandName === 'disableverification') {
    verificationEnabled = !verificationEnabled;
    interaction.reply(`✅ Verification has been ${verificationEnabled ? 'enabled' : 'disabled'}.`);
  }

  if (commandName === 'setverrole') {
    verificationRoleName = options.getString('rolename');
    interaction.reply(`✅ Role for verified users set to **${verificationRoleName}**.`);
  }

  if (commandName === 'verifystatus') {
    const embed = new EmbedBuilder()
      .setTitle('📋 AvatarCheck Settings')
      .addFields(
        { name: 'Verification', value: verificationEnabled ? '✅ Enabled' : '❌ Disabled' },
        { name: 'Verification Role', value: verificationRoleName }
      )
      .setColor('Blue');

    interaction.reply({ embeds: [embed], ephemeral: true });
  }
});

client.login(process.env.DISCORD_TOKEN);
