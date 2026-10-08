# I Don't Mind the Heat

Jimmy Mittens's signature number. Original lyrics, written for Cold Case, to be generated as an AI track.

## Style prompt

> 1950s big band swing ballad, smooth confident baritone crooner, lush brass section with muted trumpets, walking upright bass, brushed drums, finger snaps, piano fills, intimate nightclub lounge, warm vintage recording, medium swing tempo, playful and romantic

Avoid naming real artists in the prompt; most generators block or penalize it.

## Lyrics

```
[Intro, spoken over a soft vamp]
Thank you, thank you. This next one's for a very special lady.
She knows who she is.

[Verse 1]
She walked in from the snowdrift and the whole room caught a glow
Her hoofsteps left a trail of sparks across the floor below
The bartender leaned over, said "Jimmy, she's a five-alarm"
I said "Pour me something frosty, pal, what's a little harm?"

[Chorus]
'Cause I don't mind the heat
When she's sweeping me off my feet
Let the icicles drip, let the snowbanks retreat
Baby, I don't mind the heat

[Verse 2]
My mama always told me, "Son, you find a girl who's cool"
But Mama never met a dame who smolders like a jewel
My scarf is getting soggy and my hat's begun to slide
But a gentleman don't sweat it with a firecracker by his side

[Chorus]
'Cause I don't mind the heat
When she's sweeping me off my feet
Let the icicles drip, let the snowbanks retreat
Baby, I don't mind the heat

[Bridge]
They say a fella like me oughta keep his distance
They say I'm built for winter, not romance
But when she leans in closer and the whole world's getting steamy
Well, a snowman's gotta take his chance

[Scat Break]
Shoo-be-doo-be, drip drip drip
Ba-da-ba-doo, a little less of me
Shoo-be-doo-be, drip drip drip
Ba-da-ba-doo-wah

[Final Chorus]
Oh, I don't mind the heat
Every kiss is a sizzle, so sweet
I'm a little bit shorter than the night that we met
Still, I don't mind the heat

[Outro]
No, I don't mind
The heat
(spoken) Say, is it warm in here, or is it just...
```

## Uses in the game

| Where | Version |
|---|---|
| Title screen | Full mix, looping (`content/audio/loading.mp3`) |
| End credits | Full mix, plays once; the credits crawl times itself to its length (`content/audio/credits.mp3`) |
| Intro alley crime scene | Muffled through the lounge wall, as the alley ambience bed (`content/audio/alley.mp3`) |

The generator's original download is kept at `music/a-snowmans-meltdown-original.mp3` (2:00) so the edits can be redone. The game versions were made with:

```
# title screen (loops): short fade in, fade out so the restart isn't a hard cut
ffmpeg -i music/a-snowmans-meltdown-original.mp3 -af "afade=t=in:d=1.5,afade=t=out:st=116:d=4" -b:a 160k content/audio/loading.mp3
# credits (plays once)
ffmpeg -i music/a-snowmans-meltdown-original.mp3 -af "afade=t=out:st=115:d=5" -b:a 160k content/audio/credits.mp3
# alley: mono, heard through the lounge wall, soft loop seam
ffmpeg -i music/a-snowmans-meltdown-original.mp3 -af "pan=mono|c0=0.5*c0+0.5*c1,lowpass=f=700,lowpass=f=700,aecho=0.8:0.6:60:0.3,volume=0.7,afade=t=in:d=3,afade=t=out:st=117:d=3" -b:a 96k content/audio/alley.mp3
```
