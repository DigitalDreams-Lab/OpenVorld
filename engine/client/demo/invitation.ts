// The page Jules builds in the demo: Buzz's birthday invitation. Opened from the party chat in the app's real file
// preview (a scriptless sandbox), so it is plain HTML and CSS.
export const INVITATION = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>You're invited: Buzz's birthday</title>
<style>
  * { box-sizing: border-box }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 40px 20px;
    font: 17px/1.6 "Trebuchet MS", system-ui, sans-serif; color: #3b2a12;
    background: radial-gradient(circle at 20% 15%, #fff6c9 0 18%, transparent 19%) 0 0 / 120px 120px,
                radial-gradient(circle at 70% 60%, #ffe58a 0 10%, transparent 11%) 0 0 / 90px 90px, #ffd23f; }
  .card { width: min(560px, 100%); background: #fffdf4; border-radius: 28px; padding: 40px 36px 34px; text-align: center;
    box-shadow: 0 0 0 8px #3b2a12, 0 24px 0 8px #e0a400, 0 34px 60px rgba(59, 42, 18, .35); position: relative }
  .sun { font-size: 44px; letter-spacing: 6px; margin-top: -8px }
  .kicker { font-size: 13px; letter-spacing: .25em; font-weight: 700; color: #b57a00; margin-top: 10px }
  h1 { font-size: 44px; line-height: 1.05; margin: 10px 0 18px; letter-spacing: -.02em }
  h1 span { display: inline-block; background: #3b2a12; color: #ffd23f; padding: 0 12px; border-radius: 12px; transform: rotate(-2deg) }
  blockquote { margin: 0 auto 22px; padding: 18px 20px; max-width: 380px; background: #fff3c4; border-radius: 18px; font-style: italic; border: 2px dashed #e0a400 }
  .details { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin: 0 0 22px }
  .details div { background: #fff; border: 2px solid #3b2a12; border-radius: 14px; padding: 10px 6px; font-size: 14px }
  .details b { display: block; font-size: 22px }
  .floor { display: grid; grid-template-columns: repeat(8, 1fr); height: 34px; border-radius: 10px; overflow: hidden; border: 2px solid #3b2a12; margin-bottom: 16px }
  .floor i:nth-child(odd) { background: #3b2a12 } .floor i:nth-child(even) { background: #ffd23f }
  .shh { font-size: 14px; color: #8a6a2a }
  .bee { position: absolute; top: -26px; right: -18px; font-size: 54px; transform: rotate(14deg) }
</style>
</head>
<body>
  <main class="card">
    <div class="bee">🐝</div>
    <div class="sun">🌻🌻🌻</div>
    <div class="kicker">YOU'RE INVITED</div>
    <h1>Happy birthday,<br><span>little captain!</span></h1>
    <blockquote>Little captain, small and bright,<br>you hum our mornings into light.<br>Today the hive is all for you:<br>sweet honey cake, and sunflowers too.</blockquote>
    <div class="details">
      <div><b>🍯</b>Honey cake<br>with lemon</div>
      <div><b>🎷</b>Slow jazz,<br>very quiet</div>
      <div><b>💃</b>A dance floor,<br>bee style</div>
    </div>
    <div class="floor"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>
    <p class="shh">Today at the Party Hall · Stripes welcome · Shh, it's a surprise!</p>
  </main>
</body>
</html>
`;
