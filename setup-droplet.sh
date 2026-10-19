#!/usr/bin/env bash
# First-boot setup for a fresh DigitalOcean Ubuntu 26.04 droplet. Run it once, as root.
#
# Steps:
#   As root:
#     1. create the user panda01 and ask you for its password
#     2. add panda01 to the sudo group
#     3. copy root's ~/.ssh/authorized_keys to panda01, so the key you log in with today
#        also logs you in as panda01
#   As panda01 (the script re-runs itself through `su - panda01`):
#     4. install nginx (sudo asks for panda01's password the first time)
#     5. turn on the ufw firewall: block every incoming connection except SSH (port 22, rate-limited)
#        and nginx (ports 80 and 443), and allow every outgoing one
#     6. install nvm, then Node 26 through nvm
#     7. create a GitHub SSH key (~/.ssh/id_ed25519, no passphrase) and print its public half
#        for you to add to the repo as a deploy key
#
# Usage, from your computer:
#   scp setup-droplet.sh root@<droplet-ip>:/root/
#   ssh root@<droplet-ip>
#   bash /root/setup-droplet.sh
#
# Run it from a file, not with `curl ... | bash`: the script copies itself to panda01's home and
# runs that copy as panda01.
#
# Safe to re-run: the user, its password, its authorized_keys and the GitHub key are only created
# when they don't exist yet, so a re-run never replaces a key you already gave GitHub.
#
# @param {string} [$1] - Internal: "--as-panda01" runs the panda01 half. Leave it off.
#
# Exit codes: 0 done, 1 a step failed or a check did not pass.

# Stop at the first command that fails (-e), treat a misspelled or unset variable as an error (-u),
# and count a pipeline as failed when any command in it fails, not only the last one (pipefail).
set -euo pipefail

# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------
# The user this script creates and sets up.
readonly new_username="panda01"
# That user's home folder. `useradd --create-home` creates it.
readonly new_user_home="/home/${new_username}"
# Where root's copy of this script goes, so panda01 can run it (root's home is closed to panda01).
readonly new_user_script_copy="${new_user_home}/setup-droplet.sh"
# The argument that tells this script it is running as panda01, i.e. the second half.
readonly as_new_user_flag="--as-${new_username}"
# Where DigitalOcean put the SSH key(s) you picked when you created the droplet.
readonly root_authorized_keys="/root/.ssh/authorized_keys"
# The nvm release to install, the latest when this script was written.
readonly nvm_version="v0.40.8"
# The Node.js major version nvm installs and makes the default.
readonly node_major_version="26"
# The GitHub key's file name. id_ed25519 is a name ssh tries on its own, so
# `git clone git@github.com:...` uses this key with no ~/.ssh/config entry.
readonly github_key_file_name="id_ed25519"
# GitHub's published ed25519 host key, copied from
# https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/githubs-ssh-key-fingerprints
# With it in known_hosts, the first clone doesn't stop to ask "Are you sure you want to continue connecting?".
readonly github_host_key_line="github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl"

# ---------------------------------------------------------------------------
# Root half: the user, its sudo rights, its SSH keys, then hand over to it
# ---------------------------------------------------------------------------

# Creates panda01, gives it sudo and root's SSH keys, then runs the second half of this script as
# panda01 through `su -`.
#
# @param {string} $1 - Absolute path of this script file, copied into panda01's home for the second half.
run_root_phase() {
  # Give the argument a readable name.
  local this_script_path="$1"

  # ---- Checks before anything changes -------------------------------------
  # `id -u` prints the current user's number. root is always 0.
  local running_as_root=false
  if [[ "$(id -u)" -eq 0 ]]; then
    running_as_root=true
  fi
  if [[ "$running_as_root" != true ]]; then
    # `>&2` sends the message to stderr, where error messages belong.
    echo "Run this script as root: bash /root/setup-droplet.sh" >&2
    exit 1
  fi

  # The script has to be a real file so it can copy itself to panda01 (`curl | bash` has no file).
  local this_script_is_a_file=false
  if [[ -f "$this_script_path" ]]; then
    this_script_is_a_file=true
  fi
  if [[ "$this_script_is_a_file" != true ]]; then
    echo "Save the script to a file and run it with: bash /root/setup-droplet.sh" >&2
    exit 1
  fi

  # Without root's authorized_keys there is no key to copy, and panda01 couldn't log in with SSH.
  local root_has_authorized_keys=false
  if [[ -s "$root_authorized_keys" ]]; then
    root_has_authorized_keys=true
  fi
  if [[ "$root_has_authorized_keys" != true ]]; then
    echo "$root_authorized_keys is missing or empty, so there is no SSH key to give ${new_username}." >&2
    exit 1
  fi

  # ---- 1. Create the user -------------------------------------------------
  # `id <name>` succeeds only when that user exists. Its output isn't needed, so it goes to /dev/null.
  local new_user_already_exists=false
  if id "$new_username" > /dev/null 2>&1; then
    new_user_already_exists=true
  fi
  if [[ "$new_user_already_exists" == true ]]; then
    echo "==> ${new_username} already exists; not creating it again"
  else
    echo "==> Creating the user ${new_username}"
    # --create-home makes /home/panda01 and fills it from /etc/skel (that includes ~/.bashrc).
    # --shell /bin/bash gives it bash, which nvm needs: nvm adds its loader to ~/.bashrc.
    # useradd also creates a group with the same name, used as panda01's own group below.
    useradd --create-home --shell /bin/bash "$new_username"
  fi

  # ---- Ask you for the password -------------------------------------------
  # `passwd --status` prints "<name> <state> ...": P means a usable password is set. A new
  # user is L (locked, no password yet). awk prints only the second word, the state.
  local new_user_password_state
  new_user_password_state="$(passwd --status "$new_username" | awk '{print $2}')"
  local new_user_has_a_password=false
  if [[ "$new_user_password_state" == "P" ]]; then
    new_user_has_a_password=true
  fi
  if [[ "$new_user_has_a_password" == true ]]; then
    echo "==> ${new_username} already has a password; leaving it unchanged"
  else
    echo "==> Choose a password for ${new_username} (sudo will ask for it)"
    # `passwd` asks for the new password twice. If the two don't match it fails, so
    # `until` asks again instead of stopping the script with no password set.
    until passwd "$new_username"; do
      echo "The passwords didn't match or weren't accepted. Try again."
    done
  fi

  # ---- 2. Give the user sudo ----------------------------------------------
  echo "==> Adding ${new_username} to the sudo group"
  # --append --groups sudo adds the sudo group and keeps any other groups the user is in.
  # On Ubuntu, members of the sudo group may run any command with sudo after typing their password.
  usermod --append --groups sudo "$new_username"

  # ---- 3. Copy root's SSH keys --------------------------------------------
  echo "==> Copying root's SSH keys to ${new_username}"
  # Create panda01's ~/.ssh folder. -d means "make a directory", -m 700 lets only its owner in
  # (sshd ignores keys in a folder other users can open), -o/-g make panda01 the owner and group.
  install -d -m 700 -o "$new_username" -g "$new_username" "${new_user_home}/.ssh"
  # Where sshd looks for the keys allowed to log in as panda01.
  local new_user_authorized_keys="${new_user_home}/.ssh/authorized_keys"
  # Never overwrite an existing file: on a re-run it may have keys you added later.
  local new_user_already_has_authorized_keys=false
  if [[ -f "$new_user_authorized_keys" ]]; then
    new_user_already_has_authorized_keys=true
  fi
  if [[ "$new_user_already_has_authorized_keys" == true ]]; then
    echo "    ${new_user_authorized_keys} already exists; leaving it unchanged"
  else
    # Copy the file with mode 600 (only panda01 can read or change it), owned by panda01.
    install -m 600 -o "$new_username" -g "$new_username" "$root_authorized_keys" "$new_user_authorized_keys"
  fi

  # ---- Hand over to panda01 -----------------------------------------------
  # Copy this script into panda01's home, mode 700 (only panda01 can read or run it), owned by panda01.
  install -m 700 -o "$new_username" -g "$new_username" "$this_script_path" "$new_user_script_copy"
  # Delete that copy when this script exits, whether it finished or failed.
  trap 'rm -f "$new_user_script_copy"' EXIT

  echo "==> Switching to ${new_username} (su -) for the rest of the setup"
  # `su - panda01` logs in as panda01 with a fresh login shell: panda01's home, PATH and
  # environment. -c runs the copy with the flag that selects the second half (run_new_user_phase).
  # --pty gives that command its own terminal. Without it, `su -c` runs the command with no
  # terminal, and sudo stops with "A terminal is required to authenticate".
  su --pty - "$new_username" -c "bash '${new_user_script_copy}' ${as_new_user_flag}"

  echo
  echo "==> Done. From now on, log in as ${new_username} instead of root:"
  echo "    ssh ${new_username}@<droplet-ip>"
}

# ---------------------------------------------------------------------------
# panda01 half: nginx, firewall, nvm and Node, GitHub key
# ---------------------------------------------------------------------------

# Runs as panda01 (started by run_root_phase through `su -`). Uses sudo for system changes.
# Installs nginx, sets up ufw, installs nvm and Node, creates the GitHub key, and prints its public half.
run_new_user_phase() {
  # ---- 4. nginx -----------------------------------------------------------
  echo "==> Updating the package lists (sudo asks for ${new_username}'s password the first time)"
  # Refresh apt's list of available packages. The list baked into the droplet image is out of date.
  # This first sudo also proves panda01's sudo rights work.
  sudo apt-get update

  echo "==> Installing nginx"
  # Install nginx (the web server). ufw (the firewall) and curl (downloads) are already on
  # DigitalOcean's image; naming them makes sure. -y answers yes to "Do you want to continue?".
  # `env DEBIAN_FRONTEND=noninteractive` stops any package from opening a setup dialog.
  sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y nginx ufw curl

  echo "==> Starting nginx now and on every boot"
  # `enable` starts nginx on every boot, `--now` also starts it right away.
  # The nginx package normally does both already; this makes sure.
  sudo systemctl enable --now nginx

  # Ask nginx for its welcome page. --silent hides curl's progress bar, --fail turns an HTTP error
  # into a failed command, and the page itself is thrown away (> /dev/null).
  local nginx_is_serving=false
  if curl --silent --fail http://localhost > /dev/null; then
    nginx_is_serving=true
  fi
  if [[ "$nginx_is_serving" != true ]]; then
    echo "nginx is installed but http://localhost didn't answer. Check: sudo systemctl status nginx" >&2
    exit 1
  fi
  echo "    nginx is serving http://localhost"

  # ---- 5. Firewall --------------------------------------------------------
  echo "==> Setting up the ufw firewall"
  # Let SSH in, rate-limited: the OpenSSH profile is TCP port 22, the port you log in on.
  # `limit` lets SSH in like `allow` does, but turns away an address that opens 6 or more
  # connections within 30 seconds, which slows down bots that guess passwords. A normal login
  # is 1 connection. On a re-run, this changes the "allow" rule older versions of this script
  # added into a "limit" rule ("Rule updated"). This has to come BEFORE ufw is turned on and
  # before incoming connections are denied below, or that would cut off this SSH session.
  sudo ufw limit OpenSSH
  # Allow nginx from anywhere: the "Nginx Full" profile is TCP 80 (http) and 443 (https).
  # The nginx package added this profile when it was installed above.
  sudo ufw allow 'Nginx Full'
  # Deny every incoming connection that no rule above lets in, for example the Node app's own
  # port, which only nginx should reach. ufw always lets in traffic on localhost (so nginx can
  # still pass requests to the app) and replies to connections the droplet opened itself.
  sudo ufw default deny incoming
  # Allow every outgoing connection the droplet opens: apt, nvm, git clone and the like.
  sudo ufw default allow outgoing
  # Turn the firewall on, now and on every boot. --force skips the question "Command may disrupt
  # existing ssh connections. Proceed?", which is safe because SSH is let in above.
  sudo ufw --force enable
  # Print the rules so you can see them in the output.
  sudo ufw status verbose

  # ---- 6. nvm and Node ----------------------------------------------------
  echo "==> Installing nvm ${nvm_version}"
  # Download nvm's install script for this release and run it with bash. It installs nvm into
  # ~/.nvm and adds the lines that load nvm to ~/.bashrc, so every later login has nvm.
  curl -o- "https://raw.githubusercontent.com/nvm-sh/nvm/${nvm_version}/install.sh" | bash

  # nvm isn't safe under strict mode (it reads unset variables and returns non-zero on purpose),
  # so turn strict mode off while it runs, like forge-gym's deploy script does.
  set +euo pipefail
  # Tell nvm where the installer put it.
  export NVM_DIR="$HOME/.nvm"
  # Load nvm into this shell. ~/.bashrc only does that for interactive shells, and this one isn't.
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh"
  echo "==> Installing Node ${node_major_version}"
  # Download and install the newest Node 26 release, which comes with npm.
  nvm install "$node_major_version"
  # Make Node 26 the version every new shell starts with.
  nvm alias default "$node_major_version"
  # Strict mode back on for the rest of the script.
  set -euo pipefail

  # `command -v node` succeeds only when node is on the PATH, which nvm sets up.
  local node_is_installed=false
  if command -v node > /dev/null; then
    node_is_installed=true
  fi
  if [[ "$node_is_installed" != true ]]; then
    echo "node isn't on the PATH after 'nvm install ${node_major_version}'. Scroll up for nvm's error." >&2
    exit 1
  fi
  # `node --version` prints e.g. v26.7.0. The [[ == ]] pattern checks it starts with v26.
  local installed_node_version
  installed_node_version="$(node --version)"
  local node_is_the_requested_major=false
  if [[ "$installed_node_version" == "v${node_major_version}."* ]]; then
    node_is_the_requested_major=true
  fi
  if [[ "$node_is_the_requested_major" != true ]]; then
    echo "Expected Node ${node_major_version}, but node --version says ${installed_node_version}." >&2
    exit 1
  fi
  echo "    node ${installed_node_version}, npm $(npm --version)"

  # ---- 7. GitHub SSH key --------------------------------------------------
  # Full paths to the private key and its public half.
  local github_key_path="${HOME}/.ssh/${github_key_file_name}"
  local github_public_key_path="${github_key_path}.pub"
  # Make sure ~/.ssh exists and only panda01 can open it (700). The root half already made it.
  install -d -m 700 "${HOME}/.ssh"

  # Never replace an existing key: it may already be on GitHub.
  local github_key_already_exists=false
  if [[ -f "$github_key_path" ]]; then
    github_key_already_exists=true
  fi
  if [[ "$github_key_already_exists" == true ]]; then
    echo "==> ${github_key_path} already exists; keeping it"
  else
    echo "==> Creating the GitHub SSH key ${github_key_path}"
    # -t ed25519: the key type GitHub's guide recommends.
    # -C: a label stored in the key. GitHub shows it in the deploy key list, so it names this user
    #     and droplet ($(hostname) is the droplet's name).
    # -f: where to save the private key. The public half goes next to it with .pub added.
    # -N "": no passphrase, so `git pull` works with nobody there to type one.
    ssh-keygen -t ed25519 -C "${new_username}@$(hostname)" -f "$github_key_path" -N ""
  fi

  echo "==> Adding GitHub's published host key to ~/.ssh/known_hosts"
  # The file where ssh remembers which servers it trusts.
  local known_hosts_path="${HOME}/.ssh/known_hosts"
  # Create the file if it's missing. touch leaves an existing file's contents alone.
  touch "$known_hosts_path"
  # Only panda01 may read or change it.
  chmod 600 "$known_hosts_path"
  # grep -q answers yes/no without printing, -x matches whole lines, -F matches the text exactly.
  local github_host_key_is_known=false
  if grep -qxF "$github_host_key_line" "$known_hosts_path"; then
    github_host_key_is_known=true
  fi
  if [[ "$github_host_key_is_known" != true ]]; then
    # Add GitHub's key as a new line at the end of the file.
    echo "$github_host_key_line" >> "$known_hosts_path"
  fi

  # Print the public key with the steps to add it. `cat <<EOF` prints the lines up to EOF,
  # filling in the ${...} values. $(cat ...) puts the public key file's one line in place.
  cat <<EOF

==> Your GitHub key. Copy the one line between the markers:

----------------------------- copy below -----------------------------
$(cat "$github_public_key_path")
----------------------------- copy above -----------------------------

Add it to the repo as a deploy key:
  1. On GitHub, open the repo, then Settings > Deploy keys > Add deploy key.
  2. Title: ${new_username}@$(hostname). Key: paste the line above.
     Leave "Allow write access" unticked unless this server needs to push.
  3. Click "Add key".

Then, logged in as ${new_username}, test it and clone:
  ssh -T git@github.com
    (expect: "Hi OWNER/REPO! You've successfully authenticated, but GitHub does not provide shell access.")
  git clone git@github.com:OWNER/REPO.git
EOF
}

# ---------------------------------------------------------------------------
# Start here
# ---------------------------------------------------------------------------
# The first argument, or "" when there is none (`:-` keeps `set -u` from failing on a missing one).
first_argument="${1:-}"
if [[ "$first_argument" == "$as_new_user_flag" ]]; then
  # Started by the root half through `su -`: run the panda01 half.
  run_new_user_phase
else
  # Started by you: find this file's absolute path (readlink -f), then run the root half.
  # `|| true` lets the root half print a clear error when there is no file (`curl | bash`).
  this_script_path="$(readlink -f "${BASH_SOURCE[0]:-}" || true)"
  run_root_phase "$this_script_path"
fi
