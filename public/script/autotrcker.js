var autotrackHost = null;
var autotrackSocket = null;
var autotrackDeviceName = "";

var autotrackReconnectTimer = null;
var autotrackTimer = null;

var autotrackPrevData = null;

var autotrackRefreshInterval = 1000;
var autotrackTimeoutDelay = 10000;

var WRAM_START = 0xF50000;
var WRAM_SIZE = 0x20000;
var SAVEDATA_START = WRAM_START + 0xF000;
var SAVEDATA_SIZE = 0x500;

function autotrackStartTimer() {
    autotrackTimer = setTimeout(autotrackReadMem, autotrackRefreshInterval);
}

function autotrackSetStatus(text) {
    document.getElementById("autoTrackStatus").textContent=text;
}

function autotrackConnect(host="ws://localhost:8080") {
    if (autotrackSocket !== null || autotrackReconnectTimer !== null) {
        autotrackDisconnect();
        return;
    }

    autotrackHost = host;
    autotrackSocket = new WebSocket(host);
    autotrackSocket.binaryType = 'arraybuffer';

    autotrackSocket.onclose = function(event) {
        autotrackCleanup();
        autotrackSetStatus("Disconnected: " + event.reason);
    }

    autotrackSocket.onerror = function(event) {
        autotrackCleanup();
        autotrackSetStatus("Error");
    }
    
    autotrackSocket.onopen = autotrackOnConnect;
    
    autotrackSetStatus("Connecting");
    document.getElementById("autoTrackButton").textContent="Disconnect";

    autotrackReconnectTimer = setTimeout(function () {
        autotrackReconnectTimer = null;
        autotrackCleanup();
        autotrackConnect(autotrackHost);
    }, autotrackTimeoutDelay);
}

function autotrackDisconnect() {
    if (autotrackReconnectTimer !== null) {
        clearTimeout(autotrackReconnectTimer);
        autotrackReconnectTimer = null;
    }
    autotrackCleanup();
    document.getElementById("autoTrackButton").textContent="Connect";
}

function autotrackCleanup() {
    if (autotrackTimer !== null) {
        clearTimeout(autotrackTimer);
        autotrackTimer = null;
    }
    if (autotrackSocket !== null) {
        autotrackSocket.onopen = function () {};
        autotrackSocket.onclose = function () {};
        autotrackSocket.onmessage = function () {};
        autotrackSocket.onerror = function () {};
        autotrackSocket.close();
        autotrackSocket = null;
    }

    autotrackPrevData = null;
    autotrackSetStatus("Disonnected");
}

function autotrackOnConnect(event) {
    autotrackSetStatus("Connected, requesting devices list");

    autotrackSocket.send(JSON.stringify({
        Opcode: "DeviceList",
        Space: "SNES"
    }));
    autotrackSocket.onmessage = autotrackOnDeviceList;
}

function autotrackOnDeviceList(event) {
    var results = JSON.parse(event.data).Results;
    if (results.length < 1) {
        autotrackCleanup();
        autotrackSetStatus("No device found");
        return;
    }
    autotrackDeviceName = results[0];

    autotrackSocket.send(JSON.stringify({
        Opcode : "Attach",
        Space : "SNES",
        Operands : [autotrackDeviceName]
    }));
    autotrackSetStatus("Connected to " + autotrackDeviceName);

    autotrackStartTimer();
}

function autotrackReadMem() {
    function snesread(address, size, callback) {
        autotrackSocket.send(JSON.stringify({
            Opcode : "GetAddress",
            Space : "SNES",
            Operands : [address.toString(16), size.toString(16)]
        }));
        autotrackSocket.onmessage = callback;
    };

    if (autotrackReconnectTimer !== null)
        clearTimeout(autotrackReconnectTimer);
    autotrackReconnectTimer = setTimeout(function () {
        autotrackReconnectTimer = null;
        autotrackCleanup();
        autotrackConnect(autotrackHost);
    }, autotrackTimeoutDelay);
    
    snesread(WRAM_START + 0x10, 1, function (event) {
        var gamemode = new Uint8Array(event.data)[0];
        if (![0x07, 0x09, 0x0b].includes(gamemode)) {
            autotrackStartTimer();
            return;
        }
        snesread(SAVEDATA_START, 0x280, function (event2) {
            snesread(SAVEDATA_START + 0x280, 0x280, function (event3) {
                var data = new Uint8Array([...new Uint8Array(event2.data), ...new Uint8Array(event3.data)]);
                autotrackDoTracking(data);
                autotrackPrevData = data;
                autotrackStartTimer();
            });
        });
    });
}

function autotrackDoTracking(data) {
    function changed(offset) {
        return autotrackPrevData === null || autotrackPrevData[offset] !== data[offset];
    };
    function disabledbit(offset, mask) {
        return (data[offset] & mask) === 0 && (autotrackPrevData === null || ((autotrackPrevData[offset] & mask) !== 0));
    };
    function newbit(offset, mask) {
        return (data[offset] & mask) !== 0 && (autotrackPrevData === null || ((autotrackPrevData[offset] & mask) !== (data[offset] & mask)));
    };
    function newbit_group(locations) {
        var activated = false;
        for (const location of locations) {
            if ((data[location[0]] & location[1]) === 0)
                return false;
            if (autotrackPrevData === null || ((autotrackPrevData[location[0]] & location[1]) === 0))
                activated = true;
        }
        return activated;
    };

    function updatechest(chest, offset, mask) {
        if (newbit(offset, mask))
            rootRef.child('chestsopened').child(chest).set(true);
    };
    function updatechest_group(chest, locations) {
        if (newbit_group(locations))
            rootRef.child('chestsopened').child(chest).set(true);
    };
    
    updatechest(0, 0x226, 0x10); // King's Tomb
    updatechest_group(1, [[0x2BB, 0x40], [0x216, 0x10]]); // Sunken Treasure + Flooded Chest
    updatechest(2, 0x208, 0x10); // Link's House
    updatechest(3, 0x1FC, 0x10); // Spiral Cave
    updatechest(4, 0x218, 0x10); // Mimic Cave
    updatechest(5, 0x206, 0x10); // T A V E R N
    updatechest(6, 0x210, 0x10); // Chicken House
    updatechest(7, 0x20C, 0x10); // Brewery
    updatechest(8, 0x238, 0x10); // C House
    updatechest(9, 0x214, 0x10); // Aginah's Cave
    updatechest_group(10, [[0x21A, 0x10], [0x21A, 0x20]]); // Mire Shed Left + Right
    updatechest_group(11, [[0x1F0, 0x10], [0x1F0, 0x20]]); // Superbunny Cave Top + Bottom
    updatechest_group(12, [[0x20A, 0x10], [0x20A, 0x20], [0x20A, 0x40]]); // Sahasrahla's Hut Left + Middle + Right
    updatechest(13, 0x22E, 0x10); // Spike Cave
    updatechest_group(14, [[0x05E, 0x10], [0x05E, 0x20], [0x05E, 0x40], [0x05E, 0x80], [0x05F, 0x01]]); // Kakariko Well Top + Left + Middle + Right + Bottom
    updatechest_group(15, [[0x23A, 0x10], [0x23A, 0x20], [0x23A, 0x40], [0x23A, 0x80], [0x23B, 0x01]]); // Blind's Hut Top + Left + Right + Far Left + Far Right
    updatechest_group(16, [[0x23C, 0x10], [0x23C, 0x20], [0x23C, 0x40], [0x23C, 0x80], [0x23D, 0x04]]); // Hype Cave Top + Left + Right + Bottom + NPC
    updatechest_group(17, [[0x1DE, 0x10], [0x1DE, 0x20], [0x1DE, 0x40], [0x1DE, 0x80], [0x1DF, 0x01], [0x1FE, 0x10], [0x1FE, 0x20]]); // Paradox Lower (Far Left + Left + Right + Far Right + Middle) + Upper (Left + Right)
    updatechest(18, 0x248, 0x10); // Bonk Rock
    updatechest_group(19, [[0x246, 0x10], [0x246, 0x20], [0x246, 0x40], [0x246, 0x80], [0x247, 0x04]]); // Mini Moldorms Cave Far Left + Left + Right + Far Right + NPC
    updatechest(20, 0x240, 0x10); // Ice Rod Cave
    updatechest(21, 0x078, 0x80); // Hookshot Cave Bottom Right
    updatechest_group(22, [[0x078, 0x10], [0x078, 0x20], [0x078, 0x40]]); // Hookshot Cave Top Right + Top Left + Bottom Left
    updatechest(23, 0x20D, 0x04); // Chest Game
    updatechest(24, 0x3C9, 0x02); // Bottle Vendor
    updatechest(25, 0x410, 0x10); // Sahasrahla (GP)
    updatechest(26, 0x410, 0x08); // Stump Kid
    updatechest(27, 0x410, 0x04); // Sick Kid
    updatechest(28, 0x3C9, 0x10); // Purple Chest
    updatechest(29, 0x3C9, 0x01); // Hobo
    updatechest(30, 0x411, 0x01); // Ether Tablet
    updatechest(31, 0x411, 0x02); // Bombos Tablet
    updatechest(32, 0x410, 0x20); // Catfish
    updatechest(33, 0x410, 0x02); // King Zora
    updatechest(34, 0x410, 0x01); // Lost Old Man
    updatechest(35, 0x411, 0x20); // Potion Shop
    updatechest(36, 0x1C3, 0x02); // Lost Wood Hideout
    updatechest(37, 0x1C5, 0x02); // Lumberjack
    updatechest(38, 0x1D5, 0x04); // Spectacle Rock Cave
    updatechest(39, 0x237, 0x04); // Cave 45
    updatechest(40, 0x237, 0x02); // Graveyard Ledge
    updatechest(41, 0x24D, 0x02); // Checkerboard Cave
    updatechest(42, 0x24F, 0x04); // Hammer Pegs
    updatechest(43, 0x410, 0x80); // Library
    updatechest(44, 0x411, 0x10); // Mushroom
    updatechest(45, 0x283, 0x40); // Spectacle Rock
    updatechest(46, 0x285, 0x40); // Floating Island
    updatechest(47, 0x2A8, 0x40); // Race Game
    updatechest(48, 0x2B0, 0x40); // Desert Ledge
    updatechest(49, 0x2B5, 0x40); // Lake Hylia Island
    updatechest(50, 0x2CA, 0x40); // Bumper Cave
    updatechest(51, 0x2DB, 0x40); // Pyramid
    updatechest(52, 0x2E8, 0x40); // Dig Game
    updatechest(53, 0x301, 0x40); // Zora's Ledge
    updatechest(54, 0x2AA, 0x40); // Dig/Flute Spot
    updatechest_group(55, [[0x022, 0x10], [0x022, 0x20], [0x022, 0x40]]); // Sewers Left + Middle + Right
    updatechest_group(56, [[0x3C6, 0x01], [0x0AA, 0x10]]); // Uncle + Passage
    updatechest_group(57, [[0x0E4, 0x10], [0x0E2, 0x10], [0x100, 0x10], [0x064, 0x10]]); // Hyrule Castle Map + Boomerang + Zelda + Dark Cross
    updatechest(58, 0x024, 0x10); // Sanctuary
    updatechest(59, 0x411, 0x80); // Magic Bat
    updatechest(60, 0x411, 0x04); // Blacksmith
    updatechest_group(61, [[0x22C, 0x10], [0x22C, 0x20]]); // Fat Fairy Left + Right
    updatechest(62, 0x300, 0x40); // Pedestal
    updatechest_group(63, [[0x228, 0x10], [0x228, 0x20]]); // Waterfall Fairy Left + Right


    //if (newbit_group([[0x150, 0x10], [0x152, 0x10], [0x172, 0x10], [0x170, 0x10], [0x154, 0x10], [0x191, 0x08]])) { // Eastern Palace - Compass + Big Chest + Cannonball + Big Key Chest + Map + Boss
    //    rootRef.child('dungeonchests').child(0).set(0);
    //    rootRef.child('items').child("chest0").set(0);
    //}

    if (newbit(0x191, 0x08)) { // Eastern Palace Boss
        rootRef.child('dungeonbeaten').child(0).set(true);
        rootRef.child('items').child("boss0").set(2);
    }


    //if (newbit_group([[0x0E6, 0x10], [0x0E7, 0x04], [0x0E8, 0x10], [0x10A, 0x10], [0x0EA, 0x10], [0x067, 0x08]])) { // Desert Palace - Big Chest + Torch + Map Chest + Compass Chest + Big Key Chest + Boss
    //    rootRef.child('dungeonchests').child(1).set(0);
    //    rootRef.child('items').child("chest1").set(0);
    //}

    if (newbit(0x067, 0x08)) { // Desert Palace Boss
        rootRef.child('dungeonbeaten').child(1).set(true);
        rootRef.child('items').child("boss1").set(2);
    }


    //if (newbit_group([[0x10F, 0x04], [0x0EE, 0x10], [0x10E, 0x10], [0x04E, 0x20], [0x04E, 0x10], [0x00F, 0x08]])) { // Hera - Cage + Map Chest + Big Key Chest + Compass Chest + Big Chest + Boss
    //    rootRef.child('dungeonchests').child(2).set(0);
    //    rootRef.child('items').child("chest2").set(0);
    //}

    if (newbit(0x00F, 0x08)) { // Hera Boss
        rootRef.child('dungeonbeaten').child(2).set(true);
        rootRef.child('items').child("boss2").set(2);
    }


    //if (newbit_group([[0x1C0, 0x10], [0x1A0, 0x10]])) // Castle Tower
    //    rootRef.child('dungeonchests').child(xx).set(0);

    if (changed(0x3C5) && data[0x3C5] >= 3) // Agahnim Killed
        rootRef.child('items').child("agahnim").set(1);

/*
                  'Palace of Darkness - Shooter Room': (0x012, 0x10),
                  'Palace of Darkness - The Arena - Bridge': (0x054, 0x20),
                  'Palace of Darkness - Stalfos Basement': (0x014, 0x10),
                  'Palace of Darkness - Big Key Chest': (0x074, 0x10),
                  'Palace of Darkness - The Arena - Ledge': (0x054, 0x10),
                  'Palace of Darkness - Map Chest': (0x056, 0x10),
                  'Palace of Darkness - Compass Chest': (0x034, 0x20),
                  'Palace of Darkness - Dark Basement - Left': (0x0D4, 0x10),
                  'Palace of Darkness - Dark Basement - Right': (0x0D4, 0x20),
                  'Palace of Darkness - Dark Maze - Top': (0x032, 0x10),
                  'Palace of Darkness - Dark Maze - Bottom': (0x032, 0x20),
                  'Palace of Darkness - Big Chest': (0x034, 0x10),
                  'Palace of Darkness - Harmless Hellway': (0x034, 0x40),
*/
    if (newbit(0x0B5, 0x08)) { // Palace of Darkness Boss
        rootRef.child('dungeonbeaten').child(3).set(true);
        rootRef.child('items').child("boss3").set(2);
    }

/*
                  'Swamp Palace - Entrance': (0x050, 0x10),
                  'Swamp Palace - Map Chest': (0x06E, 0x10),
                  'Swamp Palace - Big Chest': (0x06C, 0x10),
                  'Swamp Palace - Compass Chest': (0x08C, 0x10),
                  'Swamp Palace - Big Key Chest': (0x06A, 0x10),
                  'Swamp Palace - West Chest': (0x068, 0x10),
                  'Swamp Palace - Flooded Room - Left': (0x0EC, 0x10),
                  'Swamp Palace - Flooded Room - Right': (0x0EC, 0x20),
                  'Swamp Palace - Waterfall Room': (0x0CC, 0x10),
*/
    if (newbit(0x00D, 0x08)) { // Swamp Palace Boss
        rootRef.child('dungeonbeaten').child(4).set(true);
        rootRef.child('items').child("boss4").set(2);
    }

/*
                  'Skull Woods - Compass Chest': (0x0CE, 0x10),
                  'Skull Woods - Map Chest': (0x0B0, 0x20),
                  'Skull Woods - Big Chest': (0x0B0, 0x10),
                  'Skull Woods - Pot Prison': (0x0AE, 0x20),
                  'Skull Woods - Pinball Room': (0x0D0, 0x10),
                  'Skull Woods - Big Key Chest': (0x0AE, 0x10),
                  'Skull Woods - Bridge Room': (0x0B2, 0x10),
*/
    if (newbit(0x053, 0x08)) { // Skull Woods Boss
        rootRef.child('dungeonbeaten').child(5).set(true);
        rootRef.child('items').child("boss5").set(2);
    }

/*
                  'Thieves\' Town - Big Key Chest': (0x1B6, 0x20),
                  'Thieves\' Town - Map Chest': (0x1B6, 0x10),
                  'Thieves\' Town - Compass Chest': (0x1B8, 0x10),
                  'Thieves\' Town - Ambush Chest': (0x196, 0x10),
                  'Thieves\' Town - Attic': (0x0CA, 0x10),
                  'Thieves\' Town - Big Chest': (0x088, 0x10),
                  'Thieves\' Town - Blind\'s Cell': (0x08A, 0x10),
*/
    if (newbit(0x159, 0x08)) { // Thieves Town Boss
        rootRef.child('dungeonbeaten').child(6).set(true);
        rootRef.child('items').child("boss6").set(2);
    }

/*
                  'Ice Palace - Compass Chest': (0x05C, 0x10),
                  'Ice Palace - Freezor Chest': (0x0FC, 0x10),
                  'Ice Palace - Big Chest': (0x13C, 0x10),
                  'Ice Palace - Iced T Room': (0x15C, 0x10),
                  'Ice Palace - Spike Room': (0x0BE, 0x10),
                  'Ice Palace - Big Key Chest': (0x03E, 0x10),
                  'Ice Palace - Map Chest': (0x07E, 0x10),
*/
    if (newbit(0x1BD, 0x08)) { // Ice Palace Boss
        rootRef.child('dungeonbeaten').child(7).set(true);
        rootRef.child('items').child("boss7").set(2);
    }

/*
                  'Misery Mire - Big Chest': (0x186, 0x10),
                  'Misery Mire - Map Chest': (0x186, 0x20),
                  'Misery Mire - Main Lobby': (0x184, 0x10),
                  'Misery Mire - Bridge Chest': (0x144, 0x10),
                  'Misery Mire - Spike Chest': (0x166, 0x10),
                  'Misery Mire - Compass Chest': (0x182, 0x10),
                  'Misery Mire - Big Key Chest': (0x1A2, 0x10),
*/
    if (newbit(0x121, 0x08)) { // Misery Mire Boss
        rootRef.child('dungeonbeaten').child(8).set(true);
        rootRef.child('items').child("boss8").set(2);
    }

/*
                  'Turtle Rock - Compass Chest': (0x1AC, 0x10),
                  'Turtle Rock - Roller Room - Left': (0x16E, 0x10),
                  'Turtle Rock - Roller Room - Right': (0x16E, 0x20),
                  'Turtle Rock - Chain Chomps': (0x16C, 0x10),
                  'Turtle Rock - Big Key Chest': (0x028, 0x10),
                  'Turtle Rock - Big Chest': (0x048, 0x10),
                  'Turtle Rock - Crystaroller Room': (0x008, 0x10),
                  'Turtle Rock - Eye Bridge - Bottom Left': (0x1AA, 0x80),
                  'Turtle Rock - Eye Bridge - Bottom Right': (0x1AA, 0x40),
                  'Turtle Rock - Eye Bridge - Top Left': (0x1AA, 0x20),
                  'Turtle Rock - Eye Bridge - Top Right': (0x1AA, 0x10),
*/
    if (newbit(0x149, 0x08)) { // Turtle Rock Boss
        rootRef.child('dungeonbeaten').child(9).set(true);
        rootRef.child('items').child("boss9").set(2);
    }

/*
                  'Ganons Tower - Bob\'s Torch': (0x119, 0x04),
                  'Ganons Tower - Hope Room - Left': (0x118, 0x20),
                  'Ganons Tower - Hope Room - Right': (0x118, 0x40),
                  'Ganons Tower - Tile Room': (0x11A, 0x10),
                  'Ganons Tower - Compass Room - Top Left': (0x13A, 0x10),
                  'Ganons Tower - Compass Room - Top Right': (0x13A, 0x20),
                  'Ganons Tower - Compass Room - Bottom Left': (0x13A, 0x40),
                  'Ganons Tower - Compass Room - Bottom Right': (0x13A, 0x80),
                  'Ganons Tower - DMs Room - Top Left': (0x0F6, 0x10),
                  'Ganons Tower - DMs Room - Top Right': (0x0F6, 0x20),
                  'Ganons Tower - DMs Room - Bottom Left': (0x0F6, 0x40),
                  'Ganons Tower - DMs Room - Bottom Right': (0x0F6, 0x80),
                  'Ganons Tower - Map Chest': (0x116, 0x10),
                  'Ganons Tower - Firesnake Room': (0x0FA, 0x10),
                  'Ganons Tower - Randomizer Room - Top Left': (0x0F8, 0x10),
                  'Ganons Tower - Randomizer Room - Top Right': (0x0F8, 0x20),
                  'Ganons Tower - Randomizer Room - Bottom Left': (0x0F8, 0x40),
                  'Ganons Tower - Randomizer Room - Bottom Right': (0x0F8, 0x80),
                  'Ganons Tower - Bob\'s Chest': (0x118, 0x80),
                  'Ganons Tower - Big Chest': (0x118, 0x10),
                  'Ganons Tower - Big Key Room - Left': (0x038, 0x20),
                  'Ganons Tower - Big Key Room - Right': (0x038, 0x40),
                  'Ganons Tower - Big Key Chest': (0x038, 0x10),
                  'Ganons Tower - Mini Helmasaur Room - Left': (0x07A, 0x10),
                  'Ganons Tower - Mini Helmasaur Room - Right': (0x07A, 0x20),
                  'Ganons Tower - Pre-Moldorm Chest': (0x07A, 0x40),
                  'Ganons Tower - Validation Chest': (0x09A, 0x10)
*/
    if (newbit(0x09A, 0x10)) { // Ganons Tower Boss (but let's use validation chest instead)
        rootRef.child('dungeonbeaten').child(10).set(true);
        rootRef.child('items').child("boss10").set(2);
    }

    function updatesmallkeys(dungeon, offset) {
        if (changed(offset))
            rootRef.child('smallkeys').child(dungeon).set(data[offset]);
    };
    //updatesmallkeys(xx, 0x37C); updatesmallkeys(xx, 0x37D); // Escape
    updatesmallkeys(0, 0x37E);
    updatesmallkeys(1, 0x37F);
    updatesmallkeys(2, 0x386);
    //updatesmallkeys(xx, 0x380); // Castle Tower
    updatesmallkeys(3, 0x382);
    updatesmallkeys(4, 0x381);
    updatesmallkeys(5, 0x384);
    updatesmallkeys(6, 0x387);
    updatesmallkeys(7, 0x385);
    updatesmallkeys(8, 0x383);
    updatesmallkeys(9, 0x388);
    updatesmallkeys(10, 0x389); // GT

    function updatebigkey(dungeon, offset, mask) {
        if (newbit(offset, mask))
            rootRef.child('bigkeys').child(dungeon).set(true);
    };
    updatebigkey(0, 0x367, 0x20);
    updatebigkey(1, 0x367, 0x10);
    updatebigkey(2, 0x366, 0x20);
    updatebigkey(3, 0x367, 0x02);
    updatebigkey(4, 0x367, 0x04);
    updatebigkey(5, 0x366, 0x80);
    updatebigkey(6, 0x366, 0x10);
    updatebigkey(7, 0x366, 0x40);
    updatebigkey(8, 0x367, 0x01);
    updatebigkey(9, 0x366, 0x08);
    updatebigkey(10, 0x366, 0x04);

    rootRef.child('items').child("bomb").set(data[0x343] >= 0 ? 1 : 0);

    if (newbit(0x38E, 0x80))
        rootRef.child('items').child("bow").set(true);
    if (newbit(0x38E, 0x40))
        rootRef.child('items').child("silvers").set(true);

    if (newbit(0x38C, 0xC0)) {
        var bits = data[0x38C] & 0xC0;
        rootRef.child('items').child("boomerang").set(bits == 0x80 ? 1 : (bits == 0x40 ? 2 : 3));
    }

    if (disabledbit(0x38C, 0x20))
        rootRef.child('items').child("mushroom").set(false);
    if (newbit(0x38C, 0x20))
        rootRef.child('items').child("mushroom").set(true);
    if (newbit(0x38C, 0x10))
        rootRef.child('items').child("powder").set(true);

    if (newbit(0x38C, 0x04))
        rootRef.child('items').child("shovel").set(true);
    if (newbit(0x38C, 0x02))
        rootRef.child('items').child("flute").set(true);

    if (newbit(0x342, 0x01))
        rootRef.child('items').child("hookshot").set(true);

    if (newbit(0x345, 0x01))
        rootRef.child('items').child("firerod").set(true);

    if (newbit(0x346, 0x01))
        rootRef.child('items').child("icerod").set(true);

    if (newbit(0x347, 0x01))
        rootRef.child('items').child("bombos").set(true);

    if (newbit(0x348, 0x01))
        rootRef.child('items').child("ether").set(true);

    if (newbit(0x349, 0x01))
        rootRef.child('items').child("quake").set(true);

    if (newbit(0x34A, 0x01))
        rootRef.child('items').child("lantern").set(true);

    if (newbit(0x34B, 0x01))
        rootRef.child('items').child("hammer").set(true);

    if (newbit(0x34D, 0x01))
        rootRef.child('items').child("net").set(true);

    if (newbit(0x34E, 0x01))
        rootRef.child('items').child("book").set(true);

    if (newbit(0x350, 0x01))
        rootRef.child('items').child("somaria").set(true);

    if (newbit(0x351, 0x01))
        rootRef.child('items').child("byrna").set(true);

    if (newbit(0x352, 0x01))
        rootRef.child('items').child("cape").set(true);

    if (newbit(0x353, 0x02))
        rootRef.child('items').child("mirror").set(true);

    if (newbit(0x355, 0x01))
        rootRef.child('items').child("boots").set(true);

    if (newbit(0x356, 0x01))
        rootRef.child('items').child("flippers").set(true);

    if (newbit(0x357, 0x01))
        rootRef.child('items').child("moonpearl").set(true);

    if (changed(0x354))
        rootRef.child('items').child("glove").set(data[0x354]);

    if (changed(0x359))
        rootRef.child('items').child("sword").set(data[0x359]);

    if (changed(0x35A))
        rootRef.child('items').child("shield").set(data[0x35A]);

    if (changed(0x35B))
        rootRef.child('items').child("tunic").set(data[0x35B] + 1);

    if (changed(0x37B))
        rootRef.child('items').child("mpupgrade").set(data[0x37B]);

    var prevbottles = -1;
    if (autotrackPrevData !== null)
        prevbottles = (autotrackPrevData[0x35C] == 0 ? 0 : 1) + (autotrackPrevData[0x35D] == 0 ? 0 : 1) + (autotrackPrevData[0x35E] == 0 ? 0 : 1) + (autotrackPrevData[0x35F] == 0 ? 0 : 1);
    var bottles = (data[0x35C] == 0 ? 0 : 1) + (data[0x35D] == 0 ? 0 : 1) + (data[0x35E] == 0 ? 0 : 1) + (data[0x35F] == 0 ? 0 : 1);
    if (bottles != prevbottles)
        rootRef.child('items').child("bottle").set(bottles);
    
    updateAll();
}
