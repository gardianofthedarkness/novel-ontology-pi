# The world client (docs/v3/design.html §12.1): a book's world drawn from the render protocol (engine/render/protocol.mjs),
# sent by the world server (engine/render/server.mjs) over a local socket. It draws only: the ground, every building as its
# shell (one draw per model), the clutter, the people walking their tracks; it never reads the page itself.
#
# Arguments (after --): --port=<n> --token=<t> (the server's), --measure=<seconds> (time the frames with no frame cap, print
# one line "MEASURE {json}", quit), --camera=x,y,z,tx,ty,tz (where the camera stands and looks), --at=<seconds> (the clock).
# Keys: Space pause, R the line from its start, L the newest moment, F frame the people, drag to turn, right drag to move,
# wheel to zoom.
extends Node3D

var SHELL_FILL := Color.hex(0x2b86c4ff)
var SHELL_EDGE := Color.hex(0x8fd6ffff)
var BOX_EDGE := Color.hex(0x7ce6ffff)
var CLUTTER := Color.hex(0x9fb4c3ff)

var args := {}
var peer := StreamPeerTCP.new()
var greeted := false
var lost := false
var inbox := PackedByteArray()
var cell := 2.0
var floor_height := 3.0

var hud: Label
var camera: Camera3D
var target := Vector3.ZERO
var distance := 300.0
var yaw := 0.6
var pitch := 0.75
var font: SystemFont

var built := Node3D.new()      # the world (everything but the people), built again with each new state
var people := []               # [{ id, name, keys: PackedFloat32Array, crowd, cursor, label }]
var pawns: MultiMeshInstance3D
var crowd: MultiMeshInstance3D
var rings: MultiMeshInstance3D
var duration := 0.0
var live_from := 0.0
var clock := 0.0
var playing := true
var counts := {}

var measuring := 0.0
var measure_from := -1.0
var frame_times := PackedFloat32Array()
var last_tick := 0
var gpu_sum := 0.0
var cpu_sum := 0.0
var process_sum := 0.0
var connected_at := 0
var built_ms := 0

func _ready() -> void:
	for arg in OS.get_cmdline_user_args():
		var parts: PackedStringArray = arg.trim_prefix("--").split("=", true, 1)
		args[parts[0]] = parts[1] if parts.size() > 1 else "1"
	font = SystemFont.new()
	font.font_names = PackedStringArray(["Microsoft YaHei UI", "Microsoft YaHei", "Yu Gothic UI", "Noto Sans CJK SC", "Segoe UI"])
	camera = Camera3D.new()
	camera.far = 30000.0
	camera.near = 0.5
	camera.fov = 50.0
	add_child(camera)
	var light := DirectionalLight3D.new()
	light.rotation_degrees = Vector3(-55, 35, 0)
	add_child(light)
	var env := WorldEnvironment.new()
	env.environment = Environment.new()
	env.environment.background_mode = Environment.BG_COLOR
	env.environment.background_color = Color.hex(0x060c12ff)
	env.environment.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.environment.ambient_light_color = Color(1, 1, 1)
	env.environment.fog_enabled = true
	env.environment.fog_light_color = Color.hex(0x060c12ff)
	env.environment.fog_density = 0.0004
	add_child(env)
	add_child(built)
	var layer := CanvasLayer.new()
	hud = Label.new()
	hud.position = Vector2(14, 10)
	hud.add_theme_font_override("font", font)
	hud.add_theme_color_override("font_color", Color(0.75, 0.88, 0.95))
	layer.add_child(hud)
	add_child(layer)
	if args.has("msaa"):
		get_viewport().msaa_3d = [Viewport.MSAA_DISABLED, Viewport.MSAA_2X, Viewport.MSAA_4X, Viewport.MSAA_8X][int(args["msaa"])]
	if args.has("measure"):
		RenderingServer.viewport_set_measure_render_time(get_viewport().get_viewport_rid(), true)
		measuring = float(args["measure"])
		DisplayServer.window_set_vsync_mode(DisplayServer.VSYNC_DISABLED)
		Engine.max_fps = 0
	if not args.has("port"):
		hud.text = "No world server: start it with node engine/render/server.mjs <book workspace>."
		return
	hud.text = "Connecting to the world server…"
	peer.connect_to_host("127.0.0.1", int(args["port"]))
	connected_at = Time.get_ticks_msec()

func _process(delta: float) -> void:
	peer.poll()
	if greeted and peer.get_status() != StreamPeerTCP.STATUS_CONNECTED and not lost:
		lost = true
		counts["line"] = "The world server has gone (the console was closed): this window shows the world as it last stood."
	if peer.get_status() == StreamPeerTCP.STATUS_CONNECTED:
		if not greeted:
			send({ "type": "hello", "token": args.get("token", "") })
			greeted = true
		var available := peer.get_available_bytes()
		if available > 0:
			var got: Array = peer.get_data(available)
			if got[0] == OK:
				inbox.append_array(got[1])
				read_inbox()
	if duration > 0.0:
		if playing:
			clock = min(duration - 0.001, clock + delta)
		if not ("people" in str(args.get("hide", "")).split(",")):
			place_people()
	update_camera()
	measure(delta)
	if duration > 0.0:
		hud.text = "%s  ·  %d fps  ·  %s / %s%s\n%s" % [counts.get("title", ""), Engine.get_frames_per_second(), stamp(clock), stamp(duration), "" if playing else "  (paused)", counts.get("line", "")]

func send(message: Dictionary) -> void:
	var body := JSON.stringify(message).to_utf8_buffer()
	var head := PackedByteArray()
	head.resize(4)
	head.encode_u32(0, body.size())
	peer.put_data(head + body)

func read_inbox() -> void:
	while inbox.size() >= 4:
		var length := inbox.decode_u32(0)
		if inbox.size() < 4 + length:
			return
		var began := Time.get_ticks_usec()
		var message = JSON.parse_string(inbox.slice(4, 4 + length).get_string_from_utf8())
		inbox = inbox.slice(4 + length)
		timings["parse"] = timings.get("parse", 0) + (Time.get_ticks_usec() - began) / 1000
		if typeof(message) == TYPE_DICTIONARY:
			receive(message)

var models := {}               # name: { fill: ArrayMesh, edges: ArrayMesh, size: Vector3 }
var started_build := 0

var timings := {}

func receive(message: Dictionary) -> void:
	var began := Time.get_ticks_usec()
	receive_one(message)
	timings[message.get("type", "")] = (Time.get_ticks_usec() - began) / 1000

func receive_one(message: Dictionary) -> void:
	match message.get("type", ""):
		"hello":
			if message.has("empty"):
				hud.text = message["empty"]
				return
			started_build = Time.get_ticks_msec()
			cell = message.get("cell", 2.0)
			floor_height = message.get("floor", 3.0)
			counts["title"] = message.get("title", "")
			for child in built.get_children():
				child.queue_free()
			var focus = message.get("focus")
			if focus and not args.has("camera"):
				target = Vector3(focus["x"], 0, focus["z"])
				distance = max(120.0, float(focus["r"]) * 4.0)
			if args.has("camera"):
				var c: PackedStringArray = args["camera"].split(",")
				var position := Vector3(float(c[0]), float(c[1]), float(c[2]))
				target = Vector3(float(c[3]), float(c[4]), float(c[5]))
				var away := position - target
				distance = away.length()
				pitch = asin(away.y / distance)
				yaw = atan2(away.x, away.z)
		"models":
			models.clear()
			for name in message["models"]:
				models[name] = make_model(message["models"][name])
		"ground":
			build_ground(message)
		"buildings":
			build_buildings(message)
		"people":
			build_people(message)
			if not args.has("camera"):
				frame_people()
			built_ms = Time.get_ticks_msec() - started_build
			counts["line"] = "%d buildings · %d people (%d crowd) · built in %d ms" % [counts.get("buildings", 0), people.size(), counts.get("crowd", 0), built_ms]

# ---- The world ----

func floats(text: String) -> PackedFloat32Array:
	return Marshalls.base64_to_raw(text).to_float32_array()

func ints(text: String) -> PackedInt32Array:
	return Marshalls.base64_to_raw(text).to_int32_array()

func flat(color: Color, alpha: float, lines := false) -> StandardMaterial3D:
	var material := StandardMaterial3D.new()
	material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	material.albedo_color = Color(color.r, color.g, color.b, alpha)
	if alpha < 1.0:
		material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	if lines:
		material.cull_mode = BaseMaterial3D.CULL_DISABLED
	return material

func make_model(model: Dictionary) -> Dictionary:
	var xyz := floats(model["positions"])
	var vertices := PackedVector3Array()
	vertices.resize(xyz.size() / 3)
	for n in vertices.size():
		vertices[n] = Vector3(xyz[3 * n], xyz[3 * n + 1], xyz[3 * n + 2])
	# three.js faces are counter-clockwise from the front, Godot's clockwise: each triangle turned over.
	var indices := ints(model["indices"])
	for n in range(0, indices.size() - 2, 3):
		var b := indices[n + 1]
		indices[n + 1] = indices[n + 2]
		indices[n + 2] = b
	var fill := ArrayMesh.new()
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = vertices
	arrays[Mesh.ARRAY_INDEX] = indices
	fill.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	var edges := ArrayMesh.new()
	var lines := []
	lines.resize(Mesh.ARRAY_MAX)
	lines[Mesh.ARRAY_VERTEX] = vertices
	lines[Mesh.ARRAY_INDEX] = ints(model["edges"])
	edges.add_surface_from_arrays(Mesh.PRIMITIVE_LINES, lines)
	var size: Array = model["size"]
	return { "fill": fill, "edges": edges, "size": Vector3(max(size[0], 0.001), max(size[1], 0.001), max(size[2], 0.001)) }

func line_box() -> ArrayMesh:
	var mesh := ArrayMesh.new()
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	var c := [Vector3(-0.5, -0.5, -0.5), Vector3(0.5, -0.5, -0.5), Vector3(0.5, -0.5, 0.5), Vector3(-0.5, -0.5, 0.5), Vector3(-0.5, 0.5, -0.5), Vector3(0.5, 0.5, -0.5), Vector3(0.5, 0.5, 0.5), Vector3(-0.5, 0.5, 0.5)]
	arrays[Mesh.ARRAY_VERTEX] = PackedVector3Array(c)
	arrays[Mesh.ARRAY_INDEX] = PackedInt32Array([0, 1, 1, 2, 2, 3, 3, 0, 4, 5, 5, 6, 6, 7, 7, 4, 0, 4, 1, 5, 2, 6, 3, 7])
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_LINES, arrays)
	return mesh

func ring() -> ArrayMesh:
	var mesh := ArrayMesh.new()
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = PackedVector3Array([Vector3(-0.5, 0, -0.5), Vector3(0.5, 0, -0.5), Vector3(0.5, 0, 0.5), Vector3(-0.5, 0, 0.5)])
	arrays[Mesh.ARRAY_INDEX] = PackedInt32Array([0, 1, 1, 2, 2, 3, 3, 0])
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_LINES, arrays)
	return mesh

func many(mesh: Mesh, material: Material, transforms: Array, part := "") -> void:
	if transforms.is_empty():
		return
	var multimesh := MultiMesh.new()
	multimesh.transform_format = MultiMesh.TRANSFORM_3D
	multimesh.mesh = mesh
	multimesh.instance_count = transforms.size()
	for n in transforms.size():
		multimesh.set_instance_transform(n, transforms[n])
	var instance := MultiMeshInstance3D.new()
	instance.multimesh = multimesh
	instance.material_override = material
	instance.visible = not (part in str(args.get("hide", "")).split(","))
	built.add_child(instance)

# The ground: one sheet over every chunk reached, its cells' kinds an 8-bit image the shader colours, a thin dark seam
# round each cell (the web view's tiles at 98 %), nothing where no chunk is.
const GROUND_SHADER := """
shader_type spatial;
render_mode unshaded, cull_disabled, depth_draw_opaque;
uniform sampler2D kinds : filter_nearest;
uniform vec3 palette[6];
uniform vec2 cells;
void fragment() {
	float kind = floor(texture(kinds, UV).r * 255.0 + 0.5);
	if (kind < 0.5) discard;
	vec2 inside = fract(UV * cells);
	float seam = step(0.01, inside.x) * step(inside.x, 0.99) * step(0.01, inside.y) * step(inside.y, 0.99);
	ALBEDO = palette[int(kind) - 1] * mix(0.35, 1.0, seam);
	ALPHA = 0.8;
}
"""

func build_ground(message: Dictionary) -> void:
	var width := int(message["width"])
	var height := int(message["height"])
	if width == 0:
		return
	var image := Image.create_from_data(width, height, false, Image.FORMAT_R8, Marshalls.base64_to_raw(message["cells"]))
	var shader := Shader.new()
	shader.code = GROUND_SHADER
	var material := ShaderMaterial.new()
	material.shader = shader
	material.set_shader_parameter("kinds", ImageTexture.create_from_image(image))
	var palette := PackedVector3Array()
	for hex in message["palette"]:
		var c := Color(hex).srgb_to_linear()     # a shader's albedo is linear; the palette is the web view's sRGB
		palette.append(Vector3(c.r, c.g, c.b))
	while palette.size() < 6:
		palette.append(Vector3(0.07, 0.15, 0.2))
	material.set_shader_parameter("palette", palette)
	material.set_shader_parameter("cells", Vector2(width, height))
	var plane := PlaneMesh.new()
	plane.size = Vector2(width * cell, height * cell)
	var sheet := MeshInstance3D.new()
	sheet.mesh = plane
	sheet.material_override = material
	var origin: Array = message["origin"]
	sheet.position = Vector3((origin[0] + width / 2.0) * cell, -0.05, (origin[1] + height / 2.0) * cell)
	built.add_child(sheet)

func placed(values: PackedFloat32Array, n: int, size: Vector3, centred: bool) -> Transform3D:
	var x := values[7 * n]
	var y := values[7 * n + 1]
	var z := values[7 * n + 2]
	var h := values[7 * n + 5]
	var basis := Basis(Vector3.UP, -values[7 * n + 3]).scaled_local(Vector3(values[7 * n + 4] / size.x, h / size.y, values[7 * n + 6] / size.z))
	return Transform3D(basis, Vector3(x, y + (h / 2.0 if centred else 0.0), z))

func build_buildings(message: Dictionary) -> void:
	var fill := flat(SHELL_FILL, 0.09)
	var edge := flat(SHELL_EDGE, 0.5, true)
	var box_edge := flat(BOX_EDGE, 0.4, true)
	var box := line_box()
	var total := 0
	var by_model := {}
	var boxes := []
	for kind in message["kinds"]:
		var entry: Dictionary = message["kinds"][kind]
		for name in entry["models"]:
			if not models.has(name):
				continue
			var values := floats(entry["models"][name])
			var model: Dictionary = models[name]
			if not by_model.has(name):
				by_model[name] = []
			for n in values.size() / 7:
				by_model[name].append(placed(values, n, model["size"], false))
		var plain := floats(entry["boxes"])
		for n in plain.size() / 7:
			boxes.append(placed(plain, n, Vector3.ONE, true))
	for name in by_model:
		many(models[name]["fill"], fill, by_model[name], "fill")
		many(models[name]["edges"], edge, by_model[name], "edges")
		total += by_model[name].size()
	many(box, box_edge, boxes)
	total += boxes.size()
	var rings := []
	var f := floats(message["floors"])
	for n in f.size() / 6:
		rings.append(Transform3D(Basis(Vector3.UP, -f[6 * n + 3]).scaled_local(Vector3(f[6 * n + 4], 1, f[6 * n + 5])), Vector3(f[6 * n], f[6 * n + 1], f[6 * n + 2])))
	many(ring(), flat(BOX_EDGE, 0.14, true), rings, "floors")
	var clutter := floats(message["clutter"])
	var cubes := []
	var cube := BoxMesh.new()
	cube.size = Vector3(1.2, 0.9, 1.2)
	for n in clutter.size() / 2:
		cubes.append(Transform3D(Basis(), Vector3(clutter[2 * n], 0.45, clutter[2 * n + 1])))
	var clutter_look := flat(CLUTTER, 0.35)
	many(cube, clutter_look, cubes, "clutter")
	for entry in message["labels"]:
		var tag := Label3D.new()
		tag.text = entry["text"]
		tag.font = font
		tag.font_size = 32
		tag.pixel_size = 0.06
		tag.outline_size = 8
		tag.billboard = BaseMaterial3D.BILLBOARD_ENABLED
		tag.modulate = Color(1, 1, 1) if entry["named"] else Color(1, 0.83, 0.43)
		tag.position = Vector3(entry["at"][0], entry["at"][1], entry["at"][2])
		built.add_child(tag)
	counts["buildings"] = total

# ---- The people ----

func build_people(message: Dictionary) -> void:
	for person in people:
		if person["label"]:
			person["label"].queue_free()
	people.clear()
	if pawns:
		pawns.queue_free()
	if crowd:
		crowd.queue_free()
	if rings:
		rings.queue_free()
	duration = message["duration"]
	live_from = message["from"]
	clock = float(args["at"]) if args.has("at") else live_from
	var named := 0
	var crowds := 0
	for entry in message["people"]:
		var label: Label3D = null
		if not entry["crowd"]:
			label = Label3D.new()
			label.text = entry["name"]
			label.font = font
			label.font_size = 32
			label.pixel_size = 0.03
			label.outline_size = 8
			label.no_depth_test = true
			label.billboard = BaseMaterial3D.BILLBOARD_ENABLED
			label.modulate = Color(entry["color"])
			label.visible = false
			add_child(label)
		people.append({ "keys": floats(entry["keys"]), "crowd": entry["crowd"], "color": Color(entry["color"]), "cursor": 0, "label": label, "slot": crowds if entry["crowd"] else named })
		if entry["crowd"]:
			crowds += 1
		else:
			named += 1
	pawns = pawn_set(named, 0.35, 0.95, 0.7)
	crowd = pawn_set(crowds, 0.22, 0.75, 0.25)
	rings = pawn_set(named, 0.35, 0.95, 0.0)
	var torus := TorusMesh.new()
	torus.inner_radius = 0.95
	torus.outer_radius = 1.3
	rings.multimesh.mesh = torus
	for person in people:
		(crowd if person["crowd"] else pawns).multimesh.set_instance_color(person["slot"], person["color"])
		if not person["crowd"]:
			rings.multimesh.set_instance_color(person["slot"], Color(person["color"], 0.6))
	counts["crowd"] = crowds
	place_people()

func pawn_set(count: int, radius: float, height: float, glow: float) -> MultiMeshInstance3D:
	var capsule := CapsuleMesh.new()
	capsule.radius = radius
	capsule.height = height + 2.0 * radius
	var material := StandardMaterial3D.new()
	material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	material.vertex_color_use_as_albedo = true
	material.albedo_color = Color(1, 1, 1, 0.92)
	material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	var multimesh := MultiMesh.new()
	multimesh.transform_format = MultiMesh.TRANSFORM_3D
	multimesh.use_colors = true
	multimesh.mesh = capsule
	multimesh.instance_count = max(1, count)
	var instance := MultiMeshInstance3D.new()
	instance.multimesh = multimesh
	instance.material_override = material
	add_child(instance)
	return instance

var HIDDEN := Transform3D(Basis().scaled(Vector3.ZERO), Vector3(0, -10000, 0))

# Where each person is at the clock: the last key at or before it, walked toward the next when that one is walked to.
func place_people() -> void:
	for person in people:
		var keys: PackedFloat32Array = person["keys"]
		var count := keys.size() / 5
		var k: int = person["cursor"]
		if k >= count or keys[5 * k] > clock:
			k = 0
		while k + 1 < count and keys[5 * (k + 1)] <= clock:
			k += 1
		person["cursor"] = k
		var pawn_group: MultiMeshInstance3D = crowd if person["crowd"] else pawns
		var label: Label3D = person["label"]
		if count == 0 or keys[5 * k] > clock or keys[5 * k + 4] == 0.0:
			pawn_group.multimesh.set_instance_transform(person["slot"], HIDDEN)
			if label:
				label.visible = false
				rings.multimesh.set_instance_transform(person["slot"], HIDDEN)
			continue
		var p := Vector3(keys[5 * k + 1], keys[5 * k + 2], keys[5 * k + 3])
		if k + 1 < count and keys[5 * (k + 1) + 4] == 1.0:
			var t0 := keys[5 * k]
			var t1 := keys[5 * (k + 1)]
			var f: float = clamp((clock - t0) / max(1e-6, t1 - t0), 0.0, 1.0)
			p = p.lerp(Vector3(keys[5 * (k + 1) + 1], keys[5 * (k + 1) + 2], keys[5 * (k + 1) + 3]), f)
		var lift := 0.6 if person["crowd"] else 0.82
		pawn_group.multimesh.set_instance_transform(person["slot"], Transform3D(Basis(), p + Vector3(0, lift, 0)))
		if label:
			label.visible = true
			label.position = p + Vector3(0, 2.6, 0)
			rings.multimesh.set_instance_transform(person["slot"], Transform3D(Basis().scaled(Vector3(1, 0.15, 1)), p + Vector3(0, 0.05, 0)))

# ---- The camera and keys ----

func update_camera() -> void:
	pitch = clamp(pitch, -1.2, 1.5)
	distance = clamp(distance, 4.0, 20000.0)
	var away := Vector3(sin(yaw) * cos(pitch), sin(pitch), cos(yaw) * cos(pitch)) * distance
	camera.position = target + away
	camera.look_at(target, Vector3.UP)

func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseMotion:
		if event.button_mask & MOUSE_BUTTON_MASK_LEFT:
			yaw -= event.relative.x * 0.006
			pitch += event.relative.y * 0.006
		elif event.button_mask & (MOUSE_BUTTON_MASK_RIGHT | MOUSE_BUTTON_MASK_MIDDLE):
			var right := camera.global_transform.basis.x
			var ahead := Vector3(-sin(yaw), 0, -cos(yaw))
			target += (-right * event.relative.x + ahead * event.relative.y) * distance * 0.0015
	elif event is InputEventMouseButton and event.pressed:
		if event.button_index == MOUSE_BUTTON_WHEEL_UP:
			distance *= 0.88
		elif event.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			distance /= 0.88
	elif event is InputEventKey and event.pressed:
		match event.keycode:
			KEY_SPACE: playing = not playing
			KEY_R: clock = 0.0
			KEY_L: clock = live_from
			KEY_F: frame_people()

func frame_people() -> void:
	var sum := Vector3.ZERO
	var n := 0
	for person in people:
		if person["crowd"]:
			continue
		var keys: PackedFloat32Array = person["keys"]
		var k: int = person["cursor"]
		if keys.size() > 0 and keys[5 * k] <= clock and keys[5 * k + 4] != 0.0:
			sum += Vector3(keys[5 * k + 1], keys[5 * k + 2], keys[5 * k + 3])
			n += 1
	if n:
		target = sum / n
		distance = 90.0

func stamp(seconds: float) -> String:
	return "%d:%02d" % [int(seconds) / 60, int(seconds) % 60]

# ---- Timing (--measure) ----

func measure(delta: float) -> void:
	if measuring <= 0.0 or duration <= 0.0:
		return
	if measure_from < 0.0:
		measure_from = Time.get_ticks_msec() / 1000.0 + float(args.get("warm", "5"))     # time to settle first (shaders compiled)
		return
	var now := Time.get_ticks_msec() / 1000.0
	if now < measure_from:
		last_tick = Time.get_ticks_usec()
		return
	var tick := Time.get_ticks_usec()
	frame_times.append((tick - last_tick) / 1000000.0)
	var rid := get_viewport().get_viewport_rid()
	gpu_sum += RenderingServer.viewport_get_measured_render_time_gpu(rid)
	cpu_sum += RenderingServer.viewport_get_measured_render_time_cpu(rid) + RenderingServer.get_frame_setup_time_cpu()
	process_sum += Performance.get_monitor(Performance.TIME_PROCESS) * 1000.0
	last_tick = tick
	if now - measure_from < measuring:
		return
	var sorted := frame_times.duplicate()
	sorted.sort()
	var worst := sorted.slice(int(sorted.size() * 0.99))
	var sum := 0.0
	for t in frame_times:
		sum += t
	var low := 0.0
	for t in worst:
		low += t
	var result := {
		"client": "godot " + Engine.get_version_info()["string"],
		"gpu": RenderingServer.get_video_adapter_name(),
		"seconds": round(sum * 100.0) / 100.0,
		"frames": frame_times.size(),
		"fps": round(frame_times.size() / sum * 10.0) / 10.0,
		"low1": round(worst.size() / max(low, 1e-6) * 10.0) / 10.0,
		"median_ms": round(sorted[sorted.size() / 2] * 10000.0) / 10.0,
		"draw_calls": RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_TOTAL_DRAW_CALLS_IN_FRAME),
		"primitives": RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_TOTAL_PRIMITIVES_IN_FRAME),
		"video_mb": round(RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_VIDEO_MEM_USED) / 1048576.0),
		"built_ms": built_ms,
		"ready_ms": started_build - connected_at + built_ms,
		"camera": [camera.position.x, camera.position.y, camera.position.z, target.x, target.y, target.z],
		"clock": clock,
		"buildings": counts.get("buildings", 0),
		"people": people.size(),
		"timings": timings,
		"vsync": DisplayServer.window_get_vsync_mode(),
		"size": [get_viewport().size.x, get_viewport().size.y],
		"msaa": get_viewport().msaa_3d,
		"hide": args.get("hide", ""),
		"gpu_ms": round(gpu_sum / max(1, frame_times.size()) * 10.0) / 10.0,
		"cpu_render_ms": round(cpu_sum / max(1, frame_times.size()) * 10.0) / 10.0,
		"process_ms": round(process_sum / max(1, frame_times.size()) * 10.0) / 10.0,
	}
	measuring = 0.0
	if args.has("shot"):
		get_viewport().get_texture().get_image().save_png(args["shot"])
	print("MEASURE " + JSON.stringify(result))
	send({ "type": "measured", "result": result })
	await get_tree().create_timer(0.3).timeout
	get_tree().quit()
