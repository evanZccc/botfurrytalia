const { ticketsCollection } = require('../mongodb');
const { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, StringSelectMenuBuilder, PermissionsBitField, ChannelType } = require('discord.js');
const ticketIcons = require('../UI/icons/ticketicons');

let config = {};

async function loadConfig() {
    try {
        const tickets = await ticketsCollection.find({}).toArray();
        config.tickets = tickets.reduce((acc, ticket) => {
            acc[ticket.serverId] = {
                ticketChannelId: ticket.ticketChannelId,
                adminRoleId: ticket.adminRoleId,
                status: ticket.status
            };
            return acc;
        }, {});
    } catch (err) {
        //console.error('Error loading config from MongoDB:', err);
    }
}

setInterval(loadConfig, 5000);

module.exports = (client) => {
    client.on('ready', async () => {
        await loadConfig();
        monitorConfigChanges(client);
    });

    client.on('interactionCreate', async (interaction) => {
        if (interaction.isStringSelectMenu() && interaction.customId === 'select_ticket_type') {
            handleSelectMenu(interaction, client);
        } else if (interaction.isButton() && interaction.customId.startsWith('close_ticket_')) {
            handleCloseButton(interaction, client);
        }
    });
};

async function monitorConfigChanges(client) {
    let previousConfig = JSON.parse(JSON.stringify(config));

    setInterval(async () => {
        await loadConfig();
        if (JSON.stringify(config) !== JSON.stringify(previousConfig)) {
            for (const guildId of Object.keys(config.tickets)) {
                const settings = config.tickets[guildId];
                const previousSettings = previousConfig.tickets[guildId];

                if (settings && settings.status && settings.ticketChannelId && (!previousSettings || settings.ticketChannelId !== previousSettings.ticketChannelId)) {
                    const guild = client.guilds.cache.get(guildId);
                    if (!guild) continue;

                    const ticketChannel = guild.channels.cache.get(settings.ticketChannelId);
                    if (!ticketChannel) continue;

          
                    const embed = new EmbedBuilder()
                        .setAuthor({
                            name: "Benvenuto nel sistema di supporto!",
                            iconURL: ticketIcons.mainIcon,
                            url: "https://discord.gg/2nB9Vney5X"
                        })
                        .setDescription('- Fare clic sul menu in basso per creare un nuovo ticket.\n\n' +
                            '**Linee guida sui tickets:**\n' +
                            '- Non sono ammessi ticket vuoti.\n' +
                            '- Ti preghiamo di pazientare mentre aspetti una risposta dal nostro staff.')
                        .setFooter({ text: 'Siamo qui per aiutarti!', iconURL: ticketIcons.modIcon })
                        .setColor('#00FF00')
                        .setTimestamp();

                    const menu = new StringSelectMenuBuilder()
                        .setCustomId('select_ticket_type')
                        .setPlaceholder('Seleziona il tipo di ticket')
                        .addOptions([
                            { label: '🆘 Supporto', value: 'supporto' },
                            { label: '📂 Domanda', value: 'domanda' },
                            { label: '💜 Feedback', value: 'feedback' },
                            { label: '⚠️ Segnala', value: 'segnalazione' }
                        ]);

                    const row = new ActionRowBuilder().addComponents(menu);

                    await ticketChannel.send({
                        embeds: [embed],
                        components: [row]
                    });

                    previousConfig = JSON.parse(JSON.stringify(config));
                }
            }
        }
    }, 5000);
}

async function handleSelectMenu(interaction, client) {
    await interaction.deferReply({ ephemeral: true }); 

    const { guild, user, values } = interaction;
    if (!guild || !user) return;

    const guildId = guild.id;
    const userId = user.id;
    const ticketType = values[0];
    const settings = config.tickets[guildId];
    if (!settings) return;

    const ticketExists = await ticketsCollection.findOne({ guildId, userId });
    if (ticketExists) {
        return interaction.followUp({ content: 'Hai un ticket aperto.', ephemeral: true });
    }

    const ticketChannel = await guild.channels.create({
        name: `${user.username}-ticket-di-${ticketType}`,
        type: ChannelType.GuildText,
        permissionOverwrites: [
            {
                id: guild.roles.everyone,
                deny: [PermissionsBitField.Flags.ViewChannel]
            },
            {
                id: userId,
                allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory]
            },
            {
                id: settings.adminRoleId,
                allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory]
            }
        ]
    });

    const ticketId = `${guildId}-${ticketChannel.id}`;
    await ticketsCollection.insertOne({ id: ticketId, channelId: ticketChannel.id, guildId, userId, type: ticketType });

    const ticketEmbed = new EmbedBuilder()
        .setAuthor({
            name: "Ticket di supporto",
            iconURL: ticketIcons.modIcon,
            url: "https://discord.gg/2nB9Vney5X"
        })
        .setDescription(`Ciao ${user}, benvenuto nel nostro sistema di supporto!\n- Fornisci una descrizione dettagliata del problema.\n- Il nostro staff ti assisterà il prima possibile.\n- Sentiti libero di aprire un altro ticket se questo verrà chiuso.`)
        .setFooter({ text: 'La vostra soddisfazione è la nostra priorità', iconURL: ticketIcons.heartIcon })
        .setColor('#00FF00')
        .setTimestamp();

    const closeButton = new ButtonBuilder()
        .setCustomId(`close_ticket_${ticketId}`)
        .setLabel('Chiudi il ticket')
        .setStyle(ButtonStyle.Danger);

    const actionRow = new ActionRowBuilder().addComponents(closeButton);

    await ticketChannel.send({ content: `${user}`, embeds: [ticketEmbed], components: [actionRow] });

    const embed = new EmbedBuilder()
        .setColor(0x0099ff)
        .setAuthor({ 
            name: "Ticket Creato!", 
            iconURL: ticketIcons.correctIcon,
            url: "https://discord.gg/2nB9Vney5X"
        })
        .setDescription(`- Il tuo ticket di ${ticketType} è stato creato.`)
        .addFields(
            { name: 'Canale del ticket', value: `${ticketChannel.url}` },
            { name: 'Istruzioni', value: 'Descrivi dettagliatamente il tuo problema.' }
        )
        .setTimestamp()
        .setFooter({ text: 'Grazie per averci contattato!', iconURL: ticketIcons.modIcon });

    await user.send({ content: `Il tuo ticket di ${ticketType} è stato creato.`, embeds: [embed] });

    interaction.followUp({ content: 'Ticket creato!', ephemeral: true });
}

async function handleCloseButton(interaction, client) {
    await interaction.deferReply({ ephemeral: true });

    const ticketId = interaction.customId.replace('close_ticket_', '');
    const { guild, user } = interaction;
    if (!guild || !user) return;

    const ticket = await ticketsCollection.findOne({ id: ticketId });
    if (!ticket) {
        return interaction.followUp({ content: 'Ticket non trovato. Si prega di contattare lo staff!', ephemeral: true });
    }

    const ticketChannel = guild.channels.cache.get(ticket.channelId);
    if (ticketChannel) {
        setTimeout(async () => {
            await ticketChannel.delete().catch(console.error);
        }, 5000);
    }

    await ticketsCollection.deleteOne({ id: ticketId });

    const ticketUser = await client.users.fetch(ticket.userId);
    if (ticketUser) {
        const embed = new EmbedBuilder()
            .setColor(0x0099ff)
            .setAuthor({ 
                name: "Ticket chiuso!", 
                iconURL: ticketIcons.correctrIcon,
                url: "https://discord.gg/2nB9Vney5X"
            })
            .setDescription(`- Il tuo ticket è stato chiuso.`)
            .setTimestamp()
            .setFooter({ text: 'Grazie per averci contattato!', iconURL: ticketIcons.modIcon });

        await ticketUser.send({ content: `Il tuo ticket è stato chiuso.`, embeds: [embed] });
    }

    interaction.followUp({ content: 'Ticket chiuso e utente informato.', ephemeral: true });
}
