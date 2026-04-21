import 'dotenv/config';
import { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, EmbedBuilder, Events } from 'discord.js';
import { DisTube } from 'distube';
import { YtDlpPlugin } from '@distube/yt-dlp';

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

if (!TOKEN || !CLIENT_ID) {
  console.error('Missing DISCORD_TOKEN or CLIENT_ID');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
  ],
});

const distube = new DisTube(client, {
  plugins: [new YtDlpPlugin({ update: true })],
  emitNewSongOnly: true,
  joinNewVoiceChannel: true,
});

// DisTube events
distube
  .on('playSong', (queue, song) => {
    queue.textChannel?.send(`🎵 Now playing: **${song.name}** \`[${song.formattedDuration}]\` — requested by ${song.user}`);
  })
  .on('addSong', (queue, song) => {
    queue.textChannel?.send(`📋 Added to queue: **${song.name}** \`[${song.formattedDuration}]\``);
  })
  .on('addList', (queue, playlist) => {
    queue.textChannel?.send(`📋 Added playlist: **${playlist.name}** (${playlist.songs.length} songs)`);
  })
  .on('error', (error, queue) => {
    console.error('DisTube error:', error.message);
    const msg = error.message.slice(0, 1900);
    queue?.textChannel?.send(`❌ Error: ${msg}`);
  })
  .on('empty', queue => {
    queue.textChannel?.send('👻 Voice channel is empty — leaving.');
  })
  .on('finish', queue => {
    queue.textChannel?.send('✅ Queue finished.');
  });

client.once(Events.ClientReady, async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  const commands = [
    new SlashCommandBuilder()
      .setName('play')
      .setDescription('Play a song or playlist from YouTube (URL or search)')
      .addStringOption(opt => opt.setName('query').setDescription('YouTube URL or search terms').setRequired(true)),
    new SlashCommandBuilder().setName('skip').setDescription('Skip the current track'),
    new SlashCommandBuilder().setName('stop').setDescription('Stop playback and leave the channel'),
    new SlashCommandBuilder().setName('pause').setDescription('Pause playback'),
    new SlashCommandBuilder().setName('resume').setDescription('Resume playback'),
    new SlashCommandBuilder().setName('queue').setDescription('Show the current queue'),
    new SlashCommandBuilder()
      .setName('volume')
      .setDescription('Set the volume (0-100)')
      .addIntegerOption(opt => opt.setName('level').setDescription('Volume level').setRequired(true).setMinValue(0).setMaxValue(100)),
  ];

  const rest = new REST({ version: '10' }).setToken(TOKEN);
  await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands.map(c => c.toJSON()) });
  console.log('✅ Slash commands registered');
});

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const { commandName, guild, member } = interaction;

  const voiceChannel = member?.voice?.channel;

  if (commandName === 'play') {
    if (!voiceChannel) return interaction.reply({ content: '❌ Join a voice channel first.', ephemeral: true });
    const query = interaction.options.getString('query');
    await interaction.deferReply();
    try {
      await distube.play(voiceChannel, query, {
        member,
        textChannel: interaction.channel,
      });
      await interaction.editReply(`🔍 Searching and queuing: \`${query}\``);
    } catch (err) {
      console.error(err);
      await interaction.editReply(`❌ Error: ${err.message}`);
    }
  }

  else if (commandName === 'skip') {
    const queue = distube.getQueue(guild.id);
    if (!queue) return interaction.reply({ content: '❌ Nothing is playing.', ephemeral: true });
    try {
      await queue.skip();
      interaction.reply('⏭️ Skipped.');
    } catch {
      interaction.reply('❌ No next track in queue.');
    }
  }

  else if (commandName === 'stop') {
    const queue = distube.getQueue(guild.id);
    if (!queue) return interaction.reply({ content: '❌ Nothing is playing.', ephemeral: true });
    queue.stop();
    interaction.reply('⏹️ Stopped and left the channel.');
  }

  else if (commandName === 'pause') {
    const queue = distube.getQueue(guild.id);
    if (!queue) return interaction.reply({ content: '❌ Nothing is playing.', ephemeral: true });
    queue.pause();
    interaction.reply('⏸️ Paused.');
  }

  else if (commandName === 'resume') {
    const queue = distube.getQueue(guild.id);
    if (!queue) return interaction.reply({ content: '❌ Nothing is playing.', ephemeral: true });
    queue.resume();
    interaction.reply('▶️ Resumed.');
  }

  else if (commandName === 'volume') {
    const queue = distube.getQueue(guild.id);
    if (!queue) return interaction.reply({ content: '❌ Nothing is playing.', ephemeral: true });
    const level = interaction.options.getInteger('level');
    queue.setVolume(level);
    interaction.reply(`🔊 Volume set to **${level}%**`);
  }

  else if (commandName === 'queue') {
    const queue = distube.getQueue(guild.id);
    if (!queue) return interaction.reply({ content: '❌ Queue is empty.', ephemeral: true });
    const songs = queue.songs;
    const current = songs[0];
    const upcoming = songs.slice(1, 11);
    const embed = new EmbedBuilder()
      .setTitle('🎵 Current Queue')
      .setDescription(`**Now playing:** ${current.name} \`[${current.formattedDuration}]\`${upcoming.length ? '\n\n**Up next:**\n' + upcoming.map((s, i) => `${i + 1}. ${s.name} \`[${s.formattedDuration}]\``).join('\n') : ''}`)
      .setColor(0x5865F2);
    interaction.reply({ embeds: [embed] });
  }
});

client.login(TOKEN);
